/**
 * tRPC router: Submission review workflow (approve/reject uploaded material).
 * Tenant isolation derived via submission.event.tenantId, same convention as liveSession.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, createPermissionProcedure } from "~/server/api/trpc";
import { assertTenantAccess } from "~/server/auth/tenant";
import { writeAuditLog } from "~/server/auth/audit";
import { canTransition } from "~/server/domain/submission-status";

const viewProcedure = createPermissionProcedure("material:view");
const reviewProcedure = createPermissionProcedure("material:review");

// Every item must be explicitly confirmed (z.literal(true)) -- this is a
// server-side re-check of the same gate the staff dashboard UI enforces,
// not just cosmetic. See REVIEW_CHECKLIST_ITEMS in
// ~/server/domain/submission-status for the canonical item list.
const reviewChecklistSchema = z.object({
  opensCorrectly: z.literal(true),
  contentMatchesSession: z.literal(true),
  noProhibitedContent: z.literal(true),
  formatSupported: z.literal(true),
});

async function loadSubmissionWithTenantCheck(
  db: Parameters<Parameters<typeof viewProcedure["query"]>[0]>[0]["ctx"]["db"],
  session: Parameters<Parameters<typeof viewProcedure["query"]>[0]>[0]["ctx"]["session"],
  id: string,
) {
  const submission = await db.submission.findUnique({
    where: { id },
    include: { event: true },
  });
  if (!submission || submission.deletedAt) throw new TRPCError({ code: "NOT_FOUND" });
  assertTenantAccess(session, submission.event.tenantId, true);
  return submission;
}

export const submissionRouter = createTRPCRouter({
  /** List non-deleted submissions for an event, newest first. */
  listByEvent: viewProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.event.findUnique({ where: { id: input.eventId } });
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });
      assertTenantAccess(ctx.session, event.tenantId, true);
      return ctx.db.submission.findMany({
        where: { eventId: input.eventId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: {
          presenter: { select: { id: true, displayName: true, organization: true } },
          liveSession: { select: { id: true, name: true, room: { select: { name: true } } } },
        },
      });
    }),

  /** Approved submissions for a specific live session -- feeds the live-control file picker. */
  listApprovedForSession: viewProcedure
    .input(z.object({ liveSessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const ls = await ctx.db.liveSession.findUnique({
        where: { id: input.liveSessionId },
        include: { event: true },
      });
      if (!ls || ls.deletedAt) throw new TRPCError({ code: "NOT_FOUND" });
      assertTenantAccess(ctx.session, ls.event.tenantId, true);
      return ctx.db.submission.findMany({
        where: { liveSessionId: input.liveSessionId, status: "approved", deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        include: {
          presenter: { select: { id: true, displayName: true } },
        },
      });
    }),

  approve: reviewProcedure
    .input(z.object({ id: z.string().uuid(), checklist: reviewChecklistSchema }))
    .mutation(async ({ ctx, input }) => {
      const submission = await loadSubmissionWithTenantCheck(ctx.db, ctx.session, input.id);
      const transition = canTransition(submission.status, "approved");
      if (!transition.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: transition.reason });
      }
      const updated = await ctx.db.submission.update({
        where: { id: input.id },
        data: {
          status: "approved",
          reviewedAt: new Date(),
          reviewedBy: ctx.session.user.id,
          reviewChecklist: input.checklist,
        },
      });
      await writeAuditLog({
        actor_id: ctx.session.user.id,
        action: "SUBMISSION_APPROVE",
        target_type: "submission",
        target_id: input.id,
        result: "success",
        metadata: { checklist: input.checklist },
      });
      return updated;
    }),

  reject: reviewProcedure
    .input(z.object({ id: z.string().uuid(), reason: z.string().trim().min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const submission = await loadSubmissionWithTenantCheck(ctx.db, ctx.session, input.id);
      const transition = canTransition(submission.status, "rejected");
      if (!transition.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: transition.reason });
      }
      const updated = await ctx.db.submission.update({
        where: { id: input.id },
        data: {
          status: "rejected",
          reviewNote: input.reason,
          reviewedAt: new Date(),
          reviewedBy: ctx.session.user.id,
        },
      });
      await writeAuditLog({
        actor_id: ctx.session.user.id,
        action: "SUBMISSION_REJECT",
        target_type: "submission",
        target_id: input.id,
        result: "success",
        metadata: { reason: input.reason },
      });
      return updated;
    }),
});
