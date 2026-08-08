/**
 * tRPC router: PresentationAssignment management.
 * Links presenters to live sessions. Unique constraint (session + presenter)
 * enforced at both DB and application layers.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, createPermissionProcedure } from "~/server/api/trpc";
import { assertTenantAccess } from "~/server/auth/tenant";

const viewProcedure = createPermissionProcedure("event:view");
const editProcedure = createPermissionProcedure("event:edit");

export const presentationAssignmentRouter = createTRPCRouter({
  /** List all assignments for a session, ordered by sortOrder. */
  listBySession: viewProcedure
    .input(z.object({ liveSessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const ls = await ctx.db.liveSession.findUnique({
        where: { id: input.liveSessionId },
        include: { event: true },
      });
      if (!ls || ls.deletedAt) throw new TRPCError({ code: "NOT_FOUND" });
      assertTenantAccess(ctx.session, ls.event.tenantId, true);
      return ctx.db.presentationAssignment.findMany({
        where: { liveSessionId: input.liveSessionId },
        orderBy: { sortOrder: "asc" },
        include: {
          presenter: {
            select: {
              id: true,
              displayName: true,
              organization: true,
              title: true,
            },
          },
        },
      });
    }),

  /** Assign a presenter to a session. */
  assign: editProcedure
    .input(
      z.object({
        liveSessionId: z.string().uuid(),
        presenterId: z.string().uuid(),
        sortOrder: z.number().int().min(0).default(0),
        duration: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ls = await ctx.db.liveSession.findUnique({
        where: { id: input.liveSessionId },
        include: { event: true },
      });
      if (!ls || ls.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      assertTenantAccess(ctx.session, ls.event.tenantId, true);
      const presenter = await ctx.db.presenter.findUnique({
        where: { id: input.presenterId },
      });
      if (!presenter) throw new TRPCError({ code: "NOT_FOUND", message: "Presenter not found" });
      if (presenter.eventId !== ls.eventId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Presenter does not belong to this event",
        });
      }
      try {
        return await ctx.db.presentationAssignment.create({
          data: {
            id: crypto.randomUUID(),
            liveSessionId: input.liveSessionId,
            presenterId: input.presenterId,
            sortOrder: input.sortOrder,
            duration: input.duration,
          },
        });
      } catch (err: unknown) {
        const e = err as { code?: string };
        if (e.code === "P2002") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This presenter is already assigned to this session",
          });
        }
        throw err;
      }
    }),

  /** Remove a presenter from a session. */
  unassign: editProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const assignment = await ctx.db.presentationAssignment.findUnique({
        where: { id: input.id },
        include: { liveSession: { include: { event: true } } },
      });
      if (!assignment) throw new TRPCError({ code: "NOT_FOUND" });
      assertTenantAccess(ctx.session, assignment.liveSession.event.tenantId, true);
      return ctx.db.presentationAssignment.delete({ where: { id: input.id } });
    }),

  /** Update sort order or duration for an assignment. */
  reorder: editProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        sortOrder: z.number().int().min(0).optional(),
        duration: z.number().int().positive().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const assignment = await ctx.db.presentationAssignment.findUnique({
        where: { id },
        include: { liveSession: { include: { event: true } } },
      });
      if (!assignment) throw new TRPCError({ code: "NOT_FOUND" });
      assertTenantAccess(ctx.session, assignment.liveSession.event.tenantId, true);
      return ctx.db.presentationAssignment.update({ where: { id }, data });
    }),
});
