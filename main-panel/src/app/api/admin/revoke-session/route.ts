import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { getSession } from "~/server/better-auth/server";
import { db } from "~/server/db";
import { writeAuditLog, extractIp, extractUserAgent } from "~/server/auth/audit";
import { validateCsrf } from "~/server/auth/csrf";
import { assertRole } from "~/server/auth/rbac";

// ── Input validation ──────────────────────────────────────────────────

const revokeOneSchema = z.object({
  mode: z.literal("one"),
  sessionId: z.string().min(1),
});

const revokeAllSchema = z.object({
  mode: z.literal("all"),
  userId: z.string().min(1),
});

const revokeSchema = z.discriminatedUnion("mode", [
  revokeOneSchema,
  revokeAllSchema,
]);

// ── Route handler ─────────────────────────────────────────────────────

/**
 * Forced logout / session revocation (admin-only).
 *
 * Modes:
 *   - "one": revoke a specific session by its ID
 *   - "all": revoke all sessions for a target user
 *
 * Takes effect on the very next request because Better Auth validates
 * session existence in the database on every getSession() call.
 * Deleting the session row from the DB means getSession() returns null.
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

    const parsed = revokeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    if (parsed.data.mode === "one") {
      // Revoke a single session by ID.
      // Deleting the row from the DB ensures getSession() returns null
      // on the very next request for that session.
      await db.session.delete({
        where: { id: parsed.data.sessionId },
      });

      await writeAuditLog({
        actor_id: session.user.id,
        action: "REVOKE_SESSION",
        target_type: "session",
        target_id: parsed.data.sessionId,
        ip,
        user_agent: ua,
        result: "success",
      });

      return NextResponse.json({
        message: "Session revoked successfully",
      });
    }

    if (parsed.data.mode === "all") {
      const { userId } = parsed.data;

      // Revoke all sessions for the target user
      const deleted = await db.session.deleteMany({
        where: { userId },
      });

      await writeAuditLog({
        actor_id: session.user.id,
        action: "REVOKE_ALL_SESSIONS",
        target_type: "user",
        target_id: userId,
        ip,
        user_agent: ua,
        result: "success",
        metadata: { sessionsRevoked: deleted.count },
      });

      return NextResponse.json({
        message: `All sessions revoked for user ${userId} (${deleted.count} sessions)`,
      });
    }

    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return NextResponse.json(
        { error: err.error ?? err.message },
        { status: err.status },
      );
    }
    console.error("[revoke-session] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
