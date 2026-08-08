/**
 * tRPC router: Room management.
 * Rooms are sub-resources of Event. Tenant isolation is derived through
 * the Event relation (room has no tenantId directly).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, createPermissionProcedure } from "~/server/api/trpc";
import { assertTenantAccess } from "~/server/auth/tenant";

const viewProcedure = createPermissionProcedure("event:view");
const editProcedure = createPermissionProcedure("event:edit");

/** Helper: load room + event, assert tenant access, return both. */
async function loadRoomWithTenantCheck(
  db: Parameters<Parameters<typeof viewProcedure["query"]>[0]>[0]["ctx"]["db"],
  session: Parameters<Parameters<typeof viewProcedure["query"]>[0]>[0]["ctx"]["session"],
  roomId: string,
) {
  const room = await db.room.findUnique({
    where: { id: roomId },
    include: { event: true },
  });
  if (!room) throw new TRPCError({ code: "NOT_FOUND" });
  assertTenantAccess(session, room.event.tenantId, true);
  return room;
}

export const roomRouter = createTRPCRouter({
  /** List rooms for a given event. */
  listByEvent: viewProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.event.findUnique({ where: { id: input.eventId } });
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });
      assertTenantAccess(ctx.session, event.tenantId, true);
      return ctx.db.room.findMany({
        where: { eventId: input.eventId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { _count: { select: { liveSessions: true } } },
      });
    }),

  /** Get a single room. */
  getById: viewProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return loadRoomWithTenantCheck(ctx.db, ctx.session, input.id);
    }),

  /** Create a room within an event. */
  create: editProcedure
    .input(
      z.object({
        eventId: z.string().uuid(),
        name: z.string().min(1).max(200),
        capacity: z.number().int().positive().optional(),
        location: z.string().max(300).optional(),
        sortOrder: z.number().int().min(0).default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const event = await ctx.db.event.findUnique({ where: { id: input.eventId } });
      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      assertTenantAccess(ctx.session, event.tenantId, true);
      return ctx.db.room.create({
        data: {
          id: crypto.randomUUID(),
          eventId: input.eventId,
          name: input.name,
          capacity: input.capacity,
          location: input.location,
          sortOrder: input.sortOrder,
        },
      });
    }),

  /** Update a room'\''s details. */
  update: editProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        capacity: z.number().int().positive().nullable().optional(),
        location: z.string().max(300).nullable().optional(),
        sortOrder: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await loadRoomWithTenantCheck(ctx.db, ctx.session, id);
      return ctx.db.room.update({ where: { id }, data });
    }),

  /** Delete a room — only if no live sessions are assigned to it. */
  delete: editProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const room = await loadRoomWithTenantCheck(ctx.db, ctx.session, input.id);
      const sessionCount = await ctx.db.liveSession.count({
        where: { roomId: room.id },
      });
      if (sessionCount > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot delete room: ${sessionCount} session(s) are assigned to it. Reassign or delete them first.`,
        });
      }
      return ctx.db.room.delete({ where: { id: input.id } });
    }),
});
