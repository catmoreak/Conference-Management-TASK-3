/**
 * tRPC router: Submission review workflow (approve/reject uploaded material).
 * Tenant isolation derived via submission.event.tenantId, same convention as liveSession.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, createPermissionProcedure } from "~/server/api/trpc";
import { assertTenantAccess } from "~/server/auth/tenant";
import { writeAuditLog } from "~/server/auth/audit";

const viewProcedure = createPermissionProcedure("material:view");
const reviewProcedure = createPermissionProcedure("material:review");

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
        orderBy: { createdAt: "desc" },
        include: {
          presenter: { select: { id: true, displayName: true } },
        },
      });
    }),

  approve: reviewProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadSubmissionWithTenantCheck(ctx.db, ctx.session, input.id);
      const updated = await ctx.db.submission.update({
        where: { id: input.id },
        data: { status: "approved" },
      });
      await writeAuditLog({
        actor_id: ctx.session.user.id,
        action: "SUBMISSION_APPROVE",
        target_type: "submission",
        target_id: input.id,
        result: "success",
      });
      return updated;
    }),

  reject: reviewProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadSubmissionWithTenantCheck(ctx.db, ctx.session, input.id);
      const updated = await ctx.db.submission.update({
        where: { id: input.id },
        data: { status: "rejected" },
      });
      await writeAuditLog({
        actor_id: ctx.session.user.id,
        action: "SUBMISSION_REJECT",
        target_type: "submission",
        target_id: input.id,
        result: "success",
      });
      return updated;
    }),
});
