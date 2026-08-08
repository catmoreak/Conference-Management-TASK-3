/**
 * tRPC router: Client (tenant) management.
 * Admin-only — uses adminProcedure throughout (no finer permission
 * granularity needed; all client ops are cross-tenant by definition).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, createTRPCRouter } from "~/server/api/trpc";

export const clientRouter = createTRPCRouter({
  /** List all clients. */
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.client.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { events: true } },
      },
    });
  }),

  /** Get a single client by ID. */
  getById: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await ctx.db.client.findUnique({
        where: { id: input.id },
        include: { _count: { select: { events: true } } },
      });
      if (!client) throw new TRPCError({ code: "NOT_FOUND" });
      return client;
    }),

  /** Create a new client/tenant. */
  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        slug: z
          .string()
          .min(1)
          .max(80)
          .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.client.create({
          data: {
            id: crypto.randomUUID(),
            name: input.name,
            slug: input.slug,
            status: "active",
          },
        });
      } catch (err: unknown) {
        const e = err as { code?: string };
        if (e.code === "P2002") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A client with this slug already exists",
          });
        }
        throw err;
      }
    }),

  /** Update client name or status. */
  update: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        status: z.enum(["active", "suspended"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const client = await ctx.db.client.findUnique({ where: { id } });
      if (!client) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.client.update({ where: { id }, data });
    }),
});
