/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { auth } from "~/server/better-auth";
import { db } from "~/server/db";
import { assertOnboardingComplete } from "~/server/auth/mfa-gate";
import { assertPermissions, type Permission } from "~/server/auth/rbac";
import { shadowCompare } from "~/server/auth/shadow-check";
import { requireAnyRoleGrant } from "~/server/auth/authz/authorize";
import { PrismaAuthzStore } from "~/server/auth/authz/prisma-store";

const authzStore = new PrismaAuthzStore();

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const session = await auth.api.getSession({
    headers: opts.headers,
  });
  return {
    db,
    session,
    ...opts,
  };
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    // artificial delay in dev
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const end = Date.now();
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

  return result;
});

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Protected (authenticated) procedure — LEGACY
 *
 * Basic session check only. Prefer `authedProcedure` for new code, which
 * additionally enforces MFA enrollment and password-reset completion.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
      ctx: {
        // infers the `session` as non-nullable
        session: { ...ctx.session, user: ctx.session.user },
      },
    });
  });

// ── Auth-hardened procedures ────────────────────────────────────────────

/**
 * Authenticated procedure with full security checks:
 * - Session must exist
 * - User must not be banned/suspended
 * - User must have completed password reset
 * - User must have enrolled MFA
 *
 * This is the baseline for all protected routes going forward.
 */
export const authedProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const user = ctx.session.user;

    // Check for banned/suspended status
    // Note: Better Auth's admin plugin also checks `banned` at session creation,
    // but we double-check here for defense-in-depth (e.g. if user was banned
    // while they still had an active session).
    if (
      (user as Record<string, unknown>).banned === true ||
      (user as Record<string, unknown>).status === "suspended"
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Account is suspended",
      });
    }

    // Enforce onboarding gates (password reset + MFA enrollment)
    try {
      assertOnboardingComplete({ user: user as {
        twoFactorEnabled?: boolean | null;
        mustResetPassword?: boolean;
      }});
    } catch (err: unknown) {
      const error = err as { code?: string; error?: string };
      throw new TRPCError({
        code: "FORBIDDEN",
        message: error.error ?? "Onboarding incomplete",
        cause: error.code,
      });
    }

    return next({
      ctx: {
        session: { ...ctx.session, user: ctx.session.user },
      },
    });
  });

/**
 * Admin-only procedure.
 * Extends authedProcedure with role === "admin" check.
 */
export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  const role = (ctx.session.user as Record<string, unknown>).role as
    | string
    | undefined;
  if (role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Administrator access required",
    });
  }
  return next({ ctx });
});

/**
 * Staff procedure — accessible to admin and staff roles.
 * Grants all permissions except account/user management.
 */
export const staffProcedure = authedProcedure.use(({ ctx, next }) => {
  const role = (ctx.session.user as Record<string, unknown>).role as
    | string
    | undefined;
  if (role !== "admin" && role !== "staff") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Staff or administrator access required",
    });
  }
  return next({ ctx });
});

/**
 * Presentation Operations Staff procedure — accessible to all three roles,
 * but only for view/download/live-control operations.
 *
 * Usage: pass required permissions as a generic check at the router level.
 */
export const presOpsProcedure = authedProcedure.use(async ({ ctx, next }) => {
  // All three roles are allowed to reach this procedure;
  // fine-grained permission checks happen at the individual route level
  // using assertPermissions(role, ...requiredPermissions).
  //
  // NOTE: this procedure is not currently used by any router (verified --
  // zero call sites outside this definition), so the shadowCompare wiring
  // below cannot be exercised against a live server. Wired anyway so it's
  // ready the moment this procedure is actually used, not discovered as a
  // gap later.
  const role = (ctx.session.user as Record<string, unknown>).role as
    | string
    | undefined;
  const userId = String((ctx.session.user as Record<string, unknown>).id);
  await shadowCompare({
    checkName: "trpc:presOpsProcedure",
    actorId: userId,
    legacy: () => {
      if (role !== "admin" && role !== "staff" && role !== "pres_ops_staff") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Access denied for your role",
        });
      }
    },
    candidate: () => requireAnyRoleGrant({ kind: "user", userId }, authzStore),
  });
  return next({ ctx });
});

/**
 * Helper to create a procedure that checks specific permissions.
 * Usage: createPermissionProcedure("material:upload", "material:delete")
 */
export function createPermissionProcedure(...permissions: Permission[]) {
  return authedProcedure.use(({ ctx, next }) => {
    const role = (ctx.session.user as Record<string, unknown>).role as
      | string
      | undefined;
    try {
      assertPermissions(role, ...permissions);
    } catch (err: unknown) {
      const error = err as { error?: string };
      throw new TRPCError({
        code: "FORBIDDEN",
        message: error.error ?? "Insufficient permissions",
      });
    }
    return next({ ctx });
  });
}
