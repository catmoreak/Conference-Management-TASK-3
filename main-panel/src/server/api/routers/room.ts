/**
 * tRPC router: Room management.
 * Rooms are sub-resources of Event. Tenant isolation is derived through
 * the Event relation (room has no tenantId directly).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, createTRPCRouter } from "~/server/api/trpc";
import { assertTenantAccess } from "~/server/auth/tenant";
import { assertCanManageCoreData, ensureUniqueRoomName } from "~/server/core-data";

async function assertRoomReadAccess(
  ctx: { db: typeof import("~/server/db").db; session: { user: Record<string, unknown> } },
  eventId: string,
) {
  const role = (ctx.session.user.role as string | undefined) ?? undefined;
  if (role !== "presenter") return;

  const userId = String((ctx.session.user.id as string | undefined) ?? "");
  if (!userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Presenter access requires an authenticated user.",
    });
  }

  const isAssigned = await ctx.db.liveSession.findFirst({
    where: {
      eventId,
      deletedAt: null,
      presentationAssignments: {
        some: { presenter: { userId } },
      },
    },
  });

  if (!isAssigned) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Presenter access is limited to events where you are assigned to a session.",
    });
  }
}

async function loadRoomWithTenantCheck(
  db: typeof import("~/server/db").db,
  session: { user: Record<string, unknown> },
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
  listByEvent: authedProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.event.findUnique({ where: { id: input.eventId } });
      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      assertTenantAccess(ctx.session, event.tenantId, true);
      await assertRoomReadAccess(ctx, input.eventId);

      return ctx.db.room.findMany({
        where: { eventId: input.eventId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { _count: { select: { liveSessions: true } } },
      });
    }),

  getById: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const room = await loadRoomWithTenantCheck(ctx.db, ctx.session, input.id);
      await assertRoomReadAccess(ctx, room.eventId);
      return room;
    }),

  create: authedProcedure
    .input(
      z.object({
        eventId: z.string().uuid(),
        name: z.string().trim().min(1).max(200),
        capacity: z.number().int().positive().nullable().optional(),
        location: z.string().trim().max(300).nullable().optional(),
        equipmentNotes: z.string().trim().max(2000).nullable().optional(),
        status: z.enum(["active", "inactive"]).default("active"),
        sortOrder: z.number().int().min(0).default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const role = (ctx.session.user.role as string | undefined) ?? undefined;
      assertCanManageCoreData(role);

      const event = await ctx.db.event.findUnique({ where: { id: input.eventId } });
      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      assertTenantAccess(ctx.session, event.tenantId, true);
      await ensureUniqueRoomName(ctx.db, input.eventId, input.name);

      return ctx.db.room.create({
        data: {
          id: crypto.randomUUID(),
          eventId: input.eventId,
          name: input.name.trim(),
          capacity: input.capacity ?? null,
          location: input.location ?? null,
          equipmentNotes: input.equipmentNotes ?? null,
          status: input.status,
          sortOrder: input.sortOrder,
        },
      });
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(200).optional(),
        capacity: z.number().int().positive().nullable().optional(),
        location: z.string().trim().max(300).nullable().optional(),
        equipmentNotes: z.string().trim().max(2000).nullable().optional(),
        status: z.enum(["active", "inactive"]).optional(),
        sortOrder: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const role = (ctx.session.user.role as string | undefined) ?? undefined;
      assertCanManageCoreData(role);

      const { id, ...data } = input;
      const room = await loadRoomWithTenantCheck(ctx.db, ctx.session, id);
      if (data.name) {
        await ensureUniqueRoomName(ctx.db, room.eventId, data.name, room.id);
      }

      return ctx.db.room.update({
        where: { id },
        data: {
          ...data,
          name: data.name?.trim(),
          location: data.location ?? undefined,
          capacity: data.capacity ?? undefined,
          equipmentNotes: data.equipmentNotes ?? undefined,
          status: data.status ?? undefined,
          sortOrder: data.sortOrder ?? undefined,
        },
      });
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const role = (ctx.session.user.role as string | undefined) ?? undefined;
      assertCanManageCoreData(role);

      const room = await loadRoomWithTenantCheck(ctx.db, ctx.session, input.id);
      const sessionCount = await ctx.db.liveSession.count({
        where: { roomId: room.id },
      });
      if (sessionCount > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot delete room: ${sessionCount} session(s) are assigned to it. Reassign or delete those sessions first.`,
        });
      }
      return ctx.db.room.delete({ where: { id: input.id } });
    }),
});
