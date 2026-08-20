import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor, admin } from "better-auth/plugins";
import { createAuthMiddleware } from "better-auth/api";

import { env } from "~/env";
import { db } from "~/server/db";
import { writeAuditLog, extractIp, extractUserAgent } from "~/server/auth/audit";
import { buildAllowedOrigins } from "~/server/http/cors";

const TAG = "[AUTH-DEBUG]";

export const auth = betterAuth({
  appName: "Conference Management",
  baseURL: env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: Array.from(buildAllowedOrigins(env.PODIUM_APP_URL, env.BETTER_AUTH_URL)).concat(["null", "file://"]),
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),

  // ── Email + Password (only auth method — no OAuth) ──────────────────
  emailAndPassword: {
    enabled: true,
  },

  // ── Session hardening ───────────────────────────────────────────────
  // 10-hour absolute max lifetime, 5-min sliding window.
  // Better Auth checks session validity server-side on every getSession()
  // call, so revoked/expired sessions take effect on the very next request.
  session: {
    expiresIn: 10 * 60 * 60, // 10 hours absolute max lifetime
    updateAge: 5 * 60,       // 5 minutes sliding expiration window
  },

  // ── Cookie security ─────────────────────────────────────────────────
  advanced: {
    defaultCookieAttributes: {
      secure: env.NODE_ENV === "production",
      httpOnly: true,
      // Podium desktop app authenticates cross-origin (file:// / null origin),
      // so session cookies must be sent in cross-site requests in production.
      sameSite: env.NODE_ENV === "production" ? "none" : "lax",
    },
  },

  // ── Rate limiting (built-in) ────────────────────────────────────────
  // Default: 100 req/60s. Custom rules for auth-critical paths.
  // customRules is an object keyed by path (relative to basePath).
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: "memory",
    customRules: {
      "/sign-in/email": { max: 5, window: 60 },
      "/two-factor/verify-totp": { max: 5, window: 60 },
      "/sign-up/email": { max: 5, window: 60 },
      "/change-password": { max: 3, window: 60 },
    },
  },

  // ── Custom user fields ──────────────────────────────────────────────
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "reviewer",
      },
      tenantId: {
        type: "string",
        required: false,
      },
      status: {
        type: "string",
        defaultValue: "active",
      },
      mustResetPassword: {
        type: "boolean",
        defaultValue: false,
      },
    },
  },

  // ── Plugins ─────────────────────────────────────────────────────────
  plugins: [
    twoFactor({
      issuer: "Conference Management",
    }),
    admin({
      defaultRole: "reviewer",
    }),
  ],

  // ── Database hooks ──────────────────────────────────────────────────
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          // Block session creation for banned/suspended users.
          // Belt-and-suspenders: admin plugin also checks `banned`,
          // but we additionally check our custom `status` field.
          const user = await db.user.findUnique({
            where: { id: session.userId },
            select: { banned: true, status: true },
          });

          if (user?.banned === true || user?.status === "suspended") {
            throw new Error("ACCOUNT_SUSPENDED");
          }

          return { data: session };
        },
      },
    },
  },

  // ── Request lifecycle hooks (audit logging) ─────────────────────────
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const path = ctx.path;

      if (path === "/sign-in/email") {
        // Extract email from request body for diagnostics
        let attemptedEmail: string | null = null;
        try {
          const body = ctx.body as { email?: string } | undefined;
          attemptedEmail = body?.email ?? null;
        } catch {
          // body not available — ignore
        }

        console.log(
          TAG,
          "sign-in attempt:",
          JSON.stringify({ email: attemptedEmail, ip: extractIp(ctx.headers ?? new Headers()) }),
        );

        if (attemptedEmail) {
          // Check DB directly so we can report the exact failure cause
          const dbUser = await db.user.findFirst({
            where: { email: attemptedEmail },
            select: { id: true, email: true, role: true, status: true, banned: true, emailVerified: true },
          });

          if (!dbUser) {
            console.warn(
              TAG,
              `sign-in REJECTED — no user row found for email "${attemptedEmail}" in the database`,
            );
          } else {
            console.log(
              TAG,
              "sign-in DB lookup — user found:",
              JSON.stringify({
                id: dbUser.id,
                email: dbUser.email,
                role: dbUser.role,
                status: dbUser.status,
                banned: dbUser.banned,
                emailVerified: dbUser.emailVerified,
              }),
            );

            if (dbUser.banned) {
              console.warn(TAG, `sign-in REJECTED — user "${attemptedEmail}" is banned`);
            } else if (dbUser.status === "suspended") {
              console.warn(TAG, `sign-in REJECTED — user "${attemptedEmail}" is suspended`);
            } else if (!dbUser.emailVerified) {
              console.warn(TAG, `sign-in NOTE — user "${attemptedEmail}" email is NOT verified`);
            }
          }
        }
      }
    }),

    after: createAuthMiddleware(async (ctx) => {
      const hdrs = ctx.headers ?? new Headers();
      const ip = extractIp(hdrs);
      const ua = extractUserAgent(hdrs);
      const path = ctx.path;

      // Determine if the response indicates success
      const returned = ctx.context?.returned as { status?: number } | undefined;
      const responseOk = !returned?.status || returned.status < 400;

      if (path === "/sign-in/email") {
        const userId = ctx.context?.newSession?.user?.id ?? null;
        const sessionId = ctx.context?.newSession?.session?.id ?? null;

        console.log(
          TAG,
          responseOk ? "sign-in SUCCESS" : "sign-in FAILURE",
          JSON.stringify({
            userId,
            sessionId,
            responseStatus: returned?.status ?? "(no status)",
            ip,
          }),
        );

        await writeAuditLog({
          actor_id: userId,
          action: responseOk ? "LOGIN_SUCCESS" : "LOGIN_FAILURE",
          target_type: "session",
          target_id: sessionId,
          ip,
          user_agent: ua,
          result: responseOk ? "success" : "failure",
        });
      }

      if (path === "/sign-out") {
        const userId = ctx.context?.session?.user?.id ??
          ctx.context?.newSession?.user?.id ?? null;
        await writeAuditLog({
          actor_id: userId,
          action: "LOGOUT",
          target_type: "session",
          target_id: null,
          ip,
          user_agent: ua,
          result: "success",
        });
      }

      if (path === "/two-factor/verify-totp") {
        const userId = ctx.context?.newSession?.user?.id ??
          ctx.context?.session?.user?.id ?? null;
        await writeAuditLog({
          actor_id: userId,
          action: responseOk ? "MFA_VERIFY_SUCCESS" : "MFA_VERIFY_FAILURE",
          target_type: "user",
          target_id: userId,
          ip,
          user_agent: ua,
          result: responseOk ? "success" : "failure",
        });
      }

      if (path === "/change-password") {
        const userId = ctx.context?.session?.user?.id ?? null;
        if (responseOk && userId) {
          await db.user.update({
            where: { id: userId },
            data: { mustResetPassword: false },
          });
        }
        await writeAuditLog({
          actor_id: userId,
          action: "PASSWORD_CHANGE",
          target_type: "user",
          target_id: userId,
          ip,
          user_agent: ua,
          result: responseOk ? "success" : "failure",
        });
      }

      if (path === "/sign-up/email") {
        const userId = ctx.context?.newSession?.user?.id ?? null;
        await writeAuditLog({
          actor_id: userId,
          action: "ACCOUNT_CREATED_VIA_SIGNUP",
          target_type: "user",
          target_id: userId,
          ip,
          user_agent: ua,
          result: responseOk ? "success" : "failure",
        });
      }
    }),
  },
});

export type Session = typeof auth.$Infer.Session;
