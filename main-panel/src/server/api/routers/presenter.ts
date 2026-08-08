/**
 * tRPC router: Presenter management.
 * No PII fields (email/phone excluded per FR-EVT-003).
 * Presenters are fully decoupled from User accounts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, createPermissionProcedure } from "~/server/api/trpc";
import { assertTenantAccess } from "~/server/auth/tenant";

const viewProcedure = createPermissionProcedure("event:view");
const editProcedure = createPermissionProcedure("event:edit");

async function loadPresenterWithTenantCheck(
  db: Parameters<Parameters<typeof viewProcedure["query"]>[0]>[0]["ctx"]["db"],
  session: Parameters<Parameters<typeof viewProcedure["query"]>[0]>[0]["ctx"]["session"],
  presenterId: string,
) {
  const presenter = await db.presenter.findUnique({
    where: { id: presenterId },
    include: { event: true },
  });
  if (!presenter) throw new TRPCError({ code: "NOT_FOUND" });
  assertTenantAccess(session, presenter.event.tenantId, true);
  return presenter;
}

export const presenterRouter = createTRPCRouter({
  /** List presenters for a given event. */
  listByEvent: viewProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.event.findUnique({ where: { id: input.eventId } });
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });
      assertTenantAccess(ctx.session, event.tenantId, true);
      return ctx.db.presenter.findMany({
        where: { eventId: input.eventId },
        orderBy: { displayName: "asc" },
        include: {
          _count: { select: { presentationAssignments: true } },
        },
      });
    }),

  /** Get a single presenter with their session assignments. */
  getById: viewProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const presenter = await ctx.db.presenter.findUnique({
        where: { id: input.id },
        include: {
          event: true,
          presentationAssignments: {
            include: { liveSession: { select: { id: true, name: true, startsAt: true } } },
            orderBy: { sortOrder: "asc" },
          },
        },
      });
      if (!presenter) throw new TRPCError({ code: "NOT_FOUND" });
      assertTenantAccess(ctx.session, presenter.event.tenantId, true);
      return presenter;
    }),

  /** Add a presenter to an event. */
  create: editProcedure
    .input(
      z.object({
        eventId: z.string().uuid(),
        displayName: z.string().min(1).max(200),
        organization: z.string().max(200).optional(),
        title: z.string().max(200).optional(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const event = await ctx.db.event.findUnique({ where: { id: input.eventId } });
      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      assertTenantAccess(ctx.session, event.tenantId, true);
      return ctx.db.presenter.create({
        data: {
          id: crypto.randomUUID(),
          eventId: input.eventId,
          displayName: input.displayName,
          organization: input.organization,
          title: input.title,
          notes: input.notes,
        },
      });
    }),

  /** Update presenter display information. No PII fields accepted. */
  update: editProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        displayName: z.string().min(1).max(200).optional(),
        organization: z.string().max(200).nullable().optional(),
        title: z.string().max(200).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await loadPresenterWithTenantCheck(ctx.db, ctx.session, id);
      return ctx.db.presenter.update({ where: { id }, data });
    }),

  /**
   * Remove a presenter from an event.
   * Cascades presentation assignments (handled by DB: DELETE RESTRICT on
   * assignment FK — callers must unassign first).
   */
  delete: editProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadPresenterWithTenantCheck(ctx.db, ctx.session, input.id);
      const assignmentCount = await ctx.db.presentationAssignment.count({
        where: { presenterId: input.id },
      });
      if (assignmentCount > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot delete presenter: ${assignmentCount} session assignment(s) exist. Remove them first via presentationAssignment.unassign.`,
        });
      }
      return ctx.db.presenter.delete({ where: { id: input.id } });
    }),
});
