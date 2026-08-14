/**
 * tRPC router: LiveSession management.
 * Soft-delete: deletedAt, consistent with Submission pattern.
 * Tenant isolation derived via liveSession.event.tenantId.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, createPermissionProcedure } from "~/server/api/trpc";
import { assertTenantAccess } from "~/server/auth/tenant";

const viewProcedure = createPermissionProcedure("event:view");
const editProcedure = createPermissionProcedure("event:edit");

async function loadSessionWithTenantCheck(
  db: Parameters<Parameters<typeof viewProcedure["query"]>[0]>[0]["ctx"]["db"],
  session: Parameters<Parameters<typeof viewProcedure["query"]>[0]>[0]["ctx"]["session"],
  liveSessionId: string,
) {
  const ls = await db.liveSession.findUnique({
    where: { id: liveSessionId },
    include: { event: true },
  });
  if (!ls || ls.deletedAt) throw new TRPCError({ code: "NOT_FOUND" });
  assertTenantAccess(session, ls.event.tenantId, true);
  return ls;
}

async function checkSessionConflict(
  db: Parameters<Parameters<typeof viewProcedure["query"]>[0]>[0]["ctx"]["db"],
  eventId: string,
  roomId: string | null | undefined,
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined,
  excludeId?: string,
) {
  if (!startsAt || !endsAt) return;

  if (endsAt <= startsAt) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "End time must be after start time",
    });
  }

  if (!roomId) return;

  const conflict = await db.liveSession.findFirst({
    where: {
      eventId,
      roomId,
      deletedAt: null,
      id: excludeId ? { not: excludeId } : undefined,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
  });

  if (conflict) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Room is already booked by "${conflict.name}" during this time.`,
    });
  }
}
function checkStatusTransition(from: string, to: string) {
  const allowed: Record<string, string[]> = {
    scheduled: ["live", "cancelled"],
    live: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  };

  if (from === to) return;

  if (!allowed[from]?.includes(to)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot change session status from "${from}" to "${to}".`,
    });
  }
}

export const liveSessionRouter = createTRPCRouter({
  /** List non-deleted sessions for a given event. */
  listByEvent: viewProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.event.findUnique({ where: { id: input.eventId } });
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });
      assertTenantAccess(ctx.session, event.tenantId, true);
      return ctx.db.liveSession.findMany({
        where: { eventId: input.eventId, deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { startsAt: "asc" }],
        include: {
          room: { select: { id: true, name: true } },
          _count: {
            select: { presentationAssignments: true, submissions: true },
          },
        },
      });
    }),

  /** Get a single live session with assignments. */
  getById: viewProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const ls = await ctx.db.liveSession.findUnique({
        where: { id: input.id },
        include: {
          event: true,
          room: true,
          presentationAssignments: {
            include: { presenter: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      });
      if (!ls || ls.deletedAt) throw new TRPCError({ code: "NOT_FOUND" });
      assertTenantAccess(ctx.session, ls.event.tenantId, true);
      return ls;
    }),

  /** Create a session within an event. */
  create: editProcedure
    .input(
      z.object({
        eventId: z.string().uuid(),
        name: z.string().min(1).max(300),
        roomId: z.string().uuid().optional(),
        startsAt: z.string().datetime().optional(),
        endsAt: z.string().datetime().optional(),
        sortOrder: z.number().int().min(0).default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const event = await ctx.db.event.findUnique({ where: { id: input.eventId } });
      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      assertTenantAccess(ctx.session, event.tenantId, true);
      if (input.roomId) {
        const room = await ctx.db.room.findUnique({ where: { id: input.roomId } });
        if (room?.eventId !== input.eventId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Room does not belong to this event",
          });
        }
      }
      const startsAt = input.startsAt ? new Date(input.startsAt) : null;
      const endsAt = input.endsAt ? new Date(input.endsAt) : null;

      await checkSessionConflict(
        ctx.db,
        input.eventId,
        input.roomId,
        startsAt,
        endsAt,
      );
      return ctx.db.liveSession.create({
        data: {
          id: crypto.randomUUID(),
          eventId: input.eventId,
          roomId: input.roomId ?? null,
          name: input.name,
          startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
          endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
          sortOrder: input.sortOrder,
          status: "scheduled",
        },
      });
    }),

  /** Update session details, room assignment, or status. */
  update: editProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(300).optional(),
        roomId: z.string().uuid().nullable().optional(),
        startsAt: z.string().datetime().nullable().optional(),
        endsAt: z.string().datetime().nullable().optional(),
        status: z.enum(["scheduled", "live", "completed", "cancelled"]).optional(),
        sortOrder: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const ls = await loadSessionWithTenantCheck(ctx.db, ctx.session, id);
      if (fields.roomId !== undefined && fields.roomId !== null) {
        const room = await ctx.db.room.findUnique({ where: { id: fields.roomId } });
        if (room?.eventId !== ls.eventId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Room does not belong to this event",
          });
        }
      }
      const startsAt =
        fields.startsAt !== undefined
          ? fields.startsAt
            ? new Date(fields.startsAt)
            : null
          : ls.startsAt;

      const endsAt =
        fields.endsAt !== undefined
          ? fields.endsAt
            ? new Date(fields.endsAt)
            : null
          : ls.endsAt;

      const roomId =
        fields.roomId !== undefined ? fields.roomId : ls.roomId;

      if (fields.status !== undefined) {
        checkStatusTransition(ls.status, fields.status);
      }

      if (fields.status === "live" && ls.status !== "live") {
        const approvedFile = await ctx.db.submission.findFirst({
          where: {
            liveSessionId: id,
            status: "approved",
            itemType: "file",
            deletedAt: null,
          },
        });

        if (!approvedFile) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Session cannot start until an approved file is linked.",
          });
        }
      }

      await checkSessionConflict(
        ctx.db,
        ls.eventId,
        roomId,
        startsAt,
        endsAt,
        id,
      );
      return ctx.db.liveSession.update({
        where: { id },
        data: {
          ...fields,
          startsAt,
          endsAt,
        },
      });
    }),

  /** Soft-delete a session. Consistent with Submission pattern (deletedAt). */
  delete: editProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadSessionWithTenantCheck(ctx.db, ctx.session, input.id);
      return ctx.db.liveSession.update({
        where: { id: input.id },
        data: { deletedAt: new Date() },
      });
    }),
});
