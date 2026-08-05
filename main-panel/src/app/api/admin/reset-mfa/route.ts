import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getSession } from "~/server/better-auth/server";
import { db } from "~/server/db";
import { writeAuditLog, extractIp, extractUserAgent } from "~/server/auth/audit";
import { validateCsrf } from "~/server/auth/csrf";
import { assertRole } from "~/server/auth/rbac";

// ── Input validation ──────────────────────────────────────────────────

const resetMfaSchema = z.object({
  userId: z.string().min(1),
  revokeAllSessions: z.boolean().optional().default(true),
});

// ── Route handler ─────────────────────────────────────────────────────

/**
 * MFA reset (admin-triggered only — never self-service without secondary verification).
 *
 * Deletes the user's TwoFactor records and sets twoFactorEnabled = false.
 * Optionally revokes all sessions to force re-login and MFA re-enrollment.
 *
 * The MFA gate in authedProcedure / assertMfaEnrolled will block the user
 * from accessing protected resources until they re-enroll.
 */
export async function POST(request: Request) {
  try {
    // CSRF protection
    validateCsrf(request);

    // Auth + RBAC: admin only
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertRole((session.user as Record<string, unknown>).role as string, "admin");

    const reqHeaders = await headers();
    const ip = extractIp(reqHeaders);
    const ua = extractUserAgent(reqHeaders);

    const body = await request.json();
    const parsed = resetMfaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { userId, revokeAllSessions } = parsed.data;

    // Verify target user exists
    const targetUser = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, twoFactorEnabled: true },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Delete all TwoFactor records for this user
    await db.twoFactor.deleteMany({
      where: { userId },
    });

    // Reset the twoFactorEnabled flag
    await db.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false },
    });

    // Optionally revoke all sessions to force re-login + MFA re-enrollment
    if (revokeAllSessions) {
      await db.session.deleteMany({
        where: { userId },
      });
    }

    await writeAuditLog({
      actor_id: session.user.id,
      action: "MFA_RESET",
      target_type: "user",
      target_id: userId,
      ip,
      user_agent: ua,
      result: "success",
      metadata: { sessionsRevoked: revokeAllSessions },
    });

    return NextResponse.json({
      message: `MFA reset for user ${userId}${revokeAllSessions ? " and all sessions revoked" : ""}`,
    });
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return NextResponse.json(
        { error: err.error ?? err.message },
        { status: err.status },
      );
    }
    console.error("[reset-mfa] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
