import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { getSession } from "~/server/better-auth/server";
import { writeAuditLog, extractIp, extractUserAgent } from "~/server/auth/audit";
import { validateCsrf } from "~/server/auth/csrf";
import { assertPermissions } from "~/server/auth/rbac";
import { assertOnboardingComplete } from "~/server/auth/mfa-gate";
import { mintWsToken } from "~/server/auth/ws-token";

// ── Input validation ─────────────────────────────────────────────────────

const mintTokenSchema = z.object({
  liveSessionId: z.string().uuid("liveSessionId must be a valid UUID"),
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
  try {
    // ── CSRF ─────────────────────────────────────────────────────────
    validateCsrf(request);

    // ── Authentication ───────────────────────────────────────────────
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
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
    assertPermissions(role, "live-control:view");

    // ── Input validation ─────────────────────────────────────────────
    const body: unknown = await request.json();
    const parsed = mintTokenSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { liveSessionId } = parsed.data;

    // ── Tenant scope ─────────────────────────────────────────────────
    // NOTE: When a LiveSession model is added, look up the session's
    // tenantId and call assertTenantAccess(session, liveSession.tenantId).
    // For now, the tenant check is implicit via the user's own tenantId.
    const tenantId = (user.tenantId as string) ?? "";

    // ── Mint JWT ─────────────────────────────────────────────────────
    const token = await mintWsToken({
      userId: session.user.id,
      liveSessionId,
      role: role ?? "",
      tenantId,
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
      metadata: { role: role ?? "none", tenantId },
    });

    return NextResponse.json({
      token,
      expiresIn: DEFAULT_WS_TOKEN_TTL,
    });
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string; code?: string };

    // Known auth/RBAC/onboarding errors throw with a status
    if (err.status) {
      return NextResponse.json(
        { error: err.error ?? err.message },
        { status: err.status },
      );
    }

    console.error("[ws/token] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
