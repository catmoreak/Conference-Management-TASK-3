/**
 * tRPC router: Event management.
 *
 * Legacy RBAC: createPermissionProcedure("event:view") / ("event:create") /
 * ("event:edit") — matches ROLE_PERMISSIONS in rbac.ts exactly.
 * Tenant isolation: tenantWhereClause / assertTenantAccess from tenant.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  createPermissionProcedure,
  adminProcedure,
} from "~/server/api/trpc";
import {
  tenantWhereClause,
  assertTenantAccess,
} from "~/server/auth/tenant";

const viewProcedure = createPermissionProcedure("event:view");
const createProcedure = createPermissionProcedure("event:create");
const editProcedure = createPermissionProcedure("event:edit");

export const eventRouter = createTRPCRouter({
  /** List events scoped to the calling user'\''s tenant. */
  list: viewProcedure.query(async ({ ctx }) => {
    const where = tenantWhereClause(ctx.session);
    return ctx.db.event.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        tenantId: true,
        name: true,
        description: true,
        startDate: true,
        endDate: true,
        location: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            rooms: true,
            liveSessions: true,
            presenters: true,
          },
        },
      },
    });
  }),

  /** Get a single event. Enforces tenant isolation. */
  getById: viewProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.event.findUnique({
        where: { id: input.id },
        include: {
          _count: {
            select: { rooms: true, liveSessions: true, presenters: true },
          },
        },
      });
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });
      assertTenantAccess(ctx.session, event.tenantId, true);
      return event;
    }),

  /** Create event under the calling user'\''s tenant. Admin can specify tenantId. */
  create: createProcedure
    .input(
      z.object({
        name: z.string().min(1).max(300),
        description: z.string().max(2000).optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
        location: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user as Record<string, unknown>;
      const tenantId = user.tenantId as string | undefined;
      if (!tenantId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "User has no tenant assigned",
        });
      }
      // Verify the client row exists
      const client = await ctx.db.client.findUnique({ where: { id: tenantId } });
      if (!client) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Tenant client record not found — create the client first",
        });
      }
      const event = await ctx.db.event.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          name: input.name,
          description: input.description,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          endDate: input.endDate ? new Date(input.endDate) : undefined,
          location: input.location,
          status: "draft",
        },
      });

      // Auto-create a default live session so the event is immediately
      // ready to receive files — users shouldn't have to understand or set
      // up Rooms/Sessions/Presenters just to upload a presentation. Power
      // users can still add more sessions/rooms later if they need them
      // (e.g. multi-track events); this one is just there so the simple
      // "one event, one file list" case works with zero extra steps.
      await ctx.db.liveSession.create({
        data: {
          id: crypto.randomUUID(),
          eventId: event.id,
          name: "Main Session",
          status: "scheduled",
          sortOrder: 0,
        },
      });

      return event;
    }),

  /** Update event details or status. Enforces tenant isolation. */
  update: editProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(300).optional(),
        description: z.string().max(2000).optional(),
        startDate: z.string().datetime().nullable().optional(),
        endDate: z.string().datetime().nullable().optional(),
        location: z.string().max(300).nullable().optional(),
        status: z
          .enum(["draft", "published", "completed", "cancelled"])
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const event = await ctx.db.event.findUnique({ where: { id } });
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });
      assertTenantAccess(ctx.session, event.tenantId, true);
      return ctx.db.event.update({
        where: { id },
        data: {
          ...fields,
          startDate:
            fields.startDate !== undefined
              ? fields.startDate
                ? new Date(fields.startDate)
                : null
              : undefined,
          endDate:
            fields.endDate !== undefined
              ? fields.endDate
                ? new Date(fields.endDate)
                : null
              : undefined,
        },
      });
    }),

  /**
   * Admin-only: list all events across all tenants.
   * Separate endpoint to keep it clearly segregated from the tenant-scoped list.
   */
  listAll: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.event.findMany({
      orderBy: { createdAt: "desc" },
      include: { client: { select: { name: true, slug: true } } },
    });
  }),
});
