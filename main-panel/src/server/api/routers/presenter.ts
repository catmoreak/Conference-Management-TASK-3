/**
 * tRPC router: Presenter management.
 * Presenters are event-scoped records that can optionally link to a User.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, createTRPCRouter } from "~/server/api/trpc";
import { assertTenantAccess } from "~/server/auth/tenant";
import { assertCanManageCoreData, ensureUniquePresenterEmail } from "~/server/core-data";

async function assertPresenterReadAccess(
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

  const hasPresenterRecord = await ctx.db.presenter.findFirst({
    where: { eventId, userId },
  });

  if (hasPresenterRecord) return;

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

async function loadPresenterWithTenantCheck(
  db: typeof import("~/server/db").db,
  session: { user: Record<string, unknown> },
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
  listByEvent: authedProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.event.findUnique({ where: { id: input.eventId } });
      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      assertTenantAccess(ctx.session, event.tenantId, true);
      await assertPresenterReadAccess(ctx, input.eventId);

      const presenters = await ctx.db.presenter.findMany({
        where: { eventId: input.eventId },
        orderBy: [{ name: "asc" }, { createdAt: "asc" }],
        include: {
          _count: { select: { presentationAssignments: true } },
        },
      });

      return presenters.map((presenter) => ({
        ...presenter,
        displayName: presenter.displayName ?? presenter.name,
      }));
    }),

  getById: authedProcedure
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
      await assertPresenterReadAccess(ctx, presenter.eventId);

      return {
        ...presenter,
        displayName: presenter.displayName ?? presenter.name,
      };
    }),

  create: authedProcedure
    .input(
      z.object({
        eventId: z.string().uuid(),
        userId: z.string().uuid().nullable().optional(),
        name: z.string().trim().min(1).max(200).optional(),
        displayName: z.string().trim().min(1).max(200).optional(),
        email: z.string().trim().email().optional(),
        bio: z.string().trim().max(2000).nullable().optional(),
        status: z.enum(["active", "inactive"]).default("active"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const role = (ctx.session.user.role as string | undefined) ?? undefined;
      assertCanManageCoreData(role);

      const event = await ctx.db.event.findUnique({ where: { id: input.eventId } });
      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      assertTenantAccess(ctx.session, event.tenantId, true);

      const presenterName = (input.name ?? input.displayName ?? "").trim();
      const presenterEmail = (input.email && input.email.trim() ? input.email.trim() : `${crypto.randomUUID()}@presenter.local`);
      if (!presenterName) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Presenter name is required.",
        });
      }

      await ensureUniquePresenterEmail(ctx.db, input.eventId, presenterEmail);
      if (input.userId) {
        const user = await ctx.db.user.findUnique({ where: { id: input.userId } });
        if (!user) {
          console.warn("[trpc.presenter.create] User not found for presenter link", {
            actorUserId: String((ctx.session.user.id as string | undefined) ?? ""),
            eventId: input.eventId,
            targetUserId: input.userId,
          });
          throw new TRPCError({ code: "BAD_REQUEST", message: "User not found" });
        }
      }

      const presenter = await ctx.db.presenter.create({
        data: {
          id: crypto.randomUUID(),
          eventId: input.eventId,
          userId: input.userId ?? null,
          name: presenterName,
          displayName: presenterName,
          email: presenterEmail,
          bio: input.bio ?? null,
          status: input.status,
        },
      });

      return {
        ...presenter,
        displayName: presenter.displayName ?? presenter.name,
      };
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        userId: z.string().uuid().nullable().optional(),
        name: z.string().trim().min(1).max(200).optional(),
        displayName: z.string().trim().min(1).max(200).optional(),
        email: z.string().trim().email().optional(),
        bio: z.string().trim().max(2000).nullable().optional(),
        status: z.enum(["active", "inactive"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const role = (ctx.session.user.role as string | undefined) ?? undefined;
      assertCanManageCoreData(role);

      const { id, ...data } = input;
      const presenter = await loadPresenterWithTenantCheck(ctx.db, ctx.session, id);
      const nextName = (data.name ?? data.displayName ?? presenter.name).trim();
      const nextEmail = (data.email && data.email.trim() ? data.email.trim() : presenter.email);

      if (!nextName) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Presenter name is required.",
        });
      }

      if (data.email || data.name || data.displayName) {
        await ensureUniquePresenterEmail(ctx.db, presenter.eventId, nextEmail, presenter.id);
      }
      if (data.userId !== undefined && data.userId !== null) {
        const user = await ctx.db.user.findUnique({ where: { id: data.userId } });
        if (!user) {
          console.warn("[trpc.presenter.update] User not found for presenter link", {
            actorUserId: String((ctx.session.user.id as string | undefined) ?? ""),
            presenterId: id,
            targetUserId: data.userId,
          });
          throw new TRPCError({ code: "BAD_REQUEST", message: "User not found" });
        }
      }

      const updated = await ctx.db.presenter.update({
        where: { id },
        data: {
          ...data,
          name: nextName,
          displayName: nextName,
          email: nextEmail,
          bio: data.bio ?? undefined,
          userId: data.userId ?? undefined,
          status: data.status ?? undefined,
        },
      });

      return {
        ...updated,
        displayName: updated.displayName ?? updated.name,
      };
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const role = (ctx.session.user.role as string | undefined) ?? undefined;
      assertCanManageCoreData(role);

      await loadPresenterWithTenantCheck(ctx.db, ctx.session, input.id);
      const assignmentCount = await ctx.db.presentationAssignment.count({
        where: { presenterId: input.id },
      });
      if (assignmentCount > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot delete presenter: ${assignmentCount} session assignment(s) still exist. Remove those assignments before deleting the presenter.`,
        });
      }
      return ctx.db.presenter.delete({ where: { id: input.id } });
    }),
});
