import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { env } from "~/env";
import { db } from "~/server/db";
import { getSession } from "~/server/better-auth/server";
import { writeAuditLog, extractIp, extractUserAgent } from "~/server/auth/audit";
import { validateCsrf } from "~/server/auth/csrf";
import { assertPermissions } from "~/server/auth/rbac";
import { assertOnboardingComplete } from "~/server/auth/mfa-gate";
import { assertTenantAccess } from "~/server/auth/tenant";
import { mintWsToken } from "~/server/auth/ws-token";
import { shadowCompare } from "~/server/auth/shadow-check";
import { authorizeAndRun } from "~/server/auth/authz/authorize";
import { PrismaAuthzStore } from "~/server/auth/authz/prisma-store";
import { buildAllowedOrigins, getOriginFromUrl, withCorsHeaders } from "~/server/http/cors";

const authzStore = new PrismaAuthzStore();

// ── Cross-origin support ─────────────────────────────────────────────────
// podium (a separate app/origin) needs to call this route directly to mint
// a "display" token -- same allowlist pattern already used by
// /api/uploads for the same reason.

export async function OPTIONS(request: Request): Promise<Response> {
  const allowedOrigins = buildAllowedOrigins(env.PODIUM_APP_URL, env.BETTER_AUTH_URL);
  const origin = request.headers.get("origin");
  const headers = new Headers();
  headers.set("Vary", "Origin, Access-Control-Request-Headers");
  headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    request.headers.get("access-control-request-headers") ?? "content-type",
  );
  headers.set("Access-Control-Allow-Credentials", "true");
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return new Response(null, { status: 204, headers });
}

// ── Input validation ─────────────────────────────────────────────────────

const mintTokenSchema = z.object({
  liveSessionId: z.string().uuid("liveSessionId must be a valid UUID"),
  purpose: z.enum(["control", "display"]).default("control"),
});

// ── Default TTL ──────────────────────────────────────────────────────────

/** Default TTL for WebSocket connect tokens (seconds). */
const DEFAULT_WS_TOKEN_TTL = 120;

// ── Route handler ────────────────────────────────────────────────────────

/**
 * POST /api/ws/token
 *
 * Authenticated endpoint that mints a short-lived JWT for use in the
 * WebSocket $connect handshake. The JWT is scoped to a specific Live
 * Session ID and signed with WS_JWT_SECRET (separate from Better Auth's
 * session secret).
 *
 * Security:
 *   - Requires valid Better Auth session cookie
 *   - Enforces onboarding gates (password reset + MFA)
 *   - RBAC: requires "live-control:view" permission
 *   - CSRF validation for the POST request
 *   - Minted JWT uses aud="ws:connect" — cannot be used on REST endpoints
 *   - TTL is clamped to [60, 300] seconds
 *
 * Request body:
 *   { liveSessionId: string (UUID) }
 *
 * Response:
 *   { token: string, expiresIn: number }
 */
export async function POST(request: Request) {
  const allowedOrigins = buildAllowedOrigins(env.PODIUM_APP_URL, env.BETTER_AUTH_URL);
  try {
    // ── CSRF / cross-origin ─────────────────────────────────────────
    const requestOrigin = request.headers.get("origin");
    if (requestOrigin && !allowedOrigins.has(requestOrigin)) {
      return withCorsHeaders(
        NextResponse.json({ error: "Forbidden origin" }, { status: 403 }),
        request,
        allowedOrigins,
      );
    }
    validateCsrf(request);

    // ── Authentication ───────────────────────────────────────────────
    const session = await getSession();
    if (!session?.user) {
      return withCorsHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        request,
        allowedOrigins,
      );
    }

    const user = session.user as Record<string, unknown>;

    // ── Onboarding gates ─────────────────────────────────────────────
    assertOnboardingComplete({
      user: {
        twoFactorEnabled: user.twoFactorEnabled as boolean | null | undefined,
        mustResetPassword: user.mustResetPassword as boolean | undefined,
      },
    });

    // ── RBAC ─────────────────────────────────────────────────────────
    const role = user.role as string | undefined;
    const userId = String(session.user.id);
    // live-control:view -> playback:read. resource=null here, not because
    // there's no equivalent resource (liveSessionId, parsed below, maps
    // directly onto the new LiveSession model) but because this check runs
    // BEFORE body parsing in this route's existing control flow -- moving
    // the check after parsing to resource-scope it properly would reorder
    // the route's logic, out of scope for a shadow-only wiring pass. Real
    // per-session scoping for this route is a follow-up, not done here.
    await shadowCompare({
      checkName: "ws/token:live-control-view",
      actorId: userId,
      legacy: () => assertPermissions(role, "live-control:view"),
      candidate: () =>
        authorizeAndRun({ kind: "user", userId }, "playback:read", null, authzStore, async () => true),
    });

    // ── Input validation ─────────────────────────────────────────────
    const body: unknown = await request.json();
    const parsed = mintTokenSchema.safeParse(body);
    if (!parsed.success) {
      return withCorsHeaders(
        NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten() },
          { status: 400 },
        ),
        request,
        allowedOrigins,
      );
    }
    const { liveSessionId, purpose } = parsed.data;

    // ── Tenant scope ─────────────────────────────────────────────────
    // live-control:view (checked above) is role-only, not session-scoped,
    // so without this lookup any such user could mint a token for a
    // liveSessionId belonging to a different tenant's event. LiveSession
    // doesn't carry tenantId directly (see schema.prisma) -- it's derived
    // via event.tenantId, same pattern as /api/live-sessions and the
    // liveSession/submission routers.
    const liveSession = await db.liveSession.findUnique({
      where: { id: liveSessionId },
      select: { event: { select: { tenantId: true } } },
    });
    if (!liveSession) {
      return withCorsHeaders(
        NextResponse.json({ error: "Live session not found" }, { status: 404 }),
        request,
        allowedOrigins,
      );
    }
    assertTenantAccess(session, liveSession.event.tenantId, true);

    const tenantId = (user.tenantId as string) ?? "";

    // ── Mint JWT ─────────────────────────────────────────────────────
    const token = await mintWsToken({
      userId: session.user.id,
      liveSessionId,
      role: role ?? "",
      tenantId,
      purpose,
      ttlSeconds: DEFAULT_WS_TOKEN_TTL,
    });

    // ── Audit log ────────────────────────────────────────────────────
    const reqHeaders = await headers();
    await writeAuditLog({
      actor_id: session.user.id,
      action: "WS_TOKEN_MINT",
      target_type: "live_session",
      target_id: liveSessionId,
      ip: extractIp(reqHeaders),
      user_agent: extractUserAgent(reqHeaders),
      result: "success",
      metadata: { role: role ?? "none", tenantId, purpose },
    });

    return withCorsHeaders(
      NextResponse.json({
        token,
        expiresIn: DEFAULT_WS_TOKEN_TTL,
      }),
      request,
      allowedOrigins,
    );
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string; code?: string };

    // Known auth/RBAC/onboarding errors throw with a status
    if (err.status) {
      return withCorsHeaders(
        NextResponse.json({ error: err.error ?? err.message }, { status: err.status }),
        request,
        allowedOrigins,
      );
    }

    console.error("[ws/token] Error:", error);
    return withCorsHeaders(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      request,
      allowedOrigins,
    );
  }
}
