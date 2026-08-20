import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "~/server/better-auth";
import { getSession } from "~/server/better-auth/server";
import { db } from "~/server/db";
import { writeAuditLog, extractIp, extractUserAgent } from "~/server/auth/audit";
import { validateCsrf } from "~/server/auth/csrf";
import { assertRole } from "~/server/auth/rbac";
import { shadowCompare } from "~/server/auth/shadow-check";
import { requireRoleGrant } from "~/server/auth/authz/authorize";
import { PrismaAuthzStore } from "~/server/auth/authz/prisma-store";

const authzStore = new PrismaAuthzStore();

// ── Input validation schemas ──────────────────────────────────────────

const createAccountSchema = z.object({
  action: z.literal("create"),
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(["admin", "reviewer", "presenter"]),
  tenantId: z.string().min(1),
});

const suspendAccountSchema = z.object({
  action: z.literal("suspend"),
  userId: z.string().min(1),
  reason: z.string().optional(),
});

const unsuspendAccountSchema = z.object({
  action: z.literal("unsuspend"),
  userId: z.string().min(1),
});

const changeRoleSchema = z.object({
  action: z.literal("change-role"),
  userId: z.string().min(1),
  role: z.enum(["admin", "reviewer", "presenter"]),
});

// ── Route handler ─────────────────────────────────────────────────────

/**
 * Account management endpoints (admin-only).
 *
 * Actions:
 *   - create: create a new account with temp password + mustResetPassword flag
 *   - suspend: ban the user via Prisma, revoke all sessions, set status = suspended
 *   - unsuspend: unban the user, set status = active
 *   - change-role: update user role, write audit log
 *
 * Pattern: temp-password (not invite-link) because no email service is
 * configured. Admin communicates the temp password out-of-band; the user
 * is forced to change it + enroll MFA on first login.
 */
export async function POST(request: Request) {
  try {
    // CSRF protection for this custom route
    validateCsrf(request);

    // Auth + RBAC: admin only
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = String((session.user as Record<string, unknown>).id);
    await shadowCompare({
      checkName: "admin/manage-account:assertRole",
      actorId: userId,
      legacy: () => assertRole((session.user as Record<string, unknown>).role as string, "admin"),
      candidate: () => requireRoleGrant({ kind: "user", userId }, "system_admin", authzStore),
    });

    const reqHeaders = await headers();
    const ip = extractIp(reqHeaders);
    const ua = extractUserAgent(reqHeaders);
    const body = await request.json();

    if (!body.action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    // ── CREATE ──────────────────────────────────────────────────────
    if (body.action === "create") {
      const parsed = createAccountSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten() },
          { status: 400 },
        );
      }
      const { email, name, password, role, tenantId } = parsed.data;

      // Step 1: Create the user via Better Auth's signUpEmail API
      // (ensures password hashing + session hooks stay consistent).
      // signUpEmail only accepts core fields.
      const result = await auth.api.signUpEmail({
        body: { email, password, name },
      });

      const newUserId = result?.user?.id ?? null;

      // Step 2: Update additional fields via Prisma
      // (role, tenantId, status, mustResetPassword)
      if (newUserId) {
        await db.user.update({
          where: { id: newUserId },
          data: {
            role,
            tenantId,
            status: "active",
            mustResetPassword: true,
          },
        });
      }

      await writeAuditLog({
        actor_id: session.user.id,
        action: "ACCOUNT_CREATE",
        target_type: "user",
        target_id: newUserId,
        ip,
        user_agent: ua,
        result: "success",
        metadata: { email, role, tenantId },
      });

      return NextResponse.json({
        message: "Account created successfully",
        userId: newUserId,
      });
    }

    // ── SUSPEND ─────────────────────────────────────────────────────
    if (body.action === "suspend") {
      const parsed = suspendAccountSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten() },
          { status: 400 },
        );
      }
      const { userId, reason } = parsed.data;

      // Prevent admin from suspending themselves
      if (userId === session.user.id) {
        return NextResponse.json(
          { error: "Cannot suspend your own account" },
          { status: 400 },
        );
      }

      // Set banned=true and status=suspended via Prisma.
      // The databaseHook on session.create.before will reject any new
      // session creation for banned users. Existing sessions are revoked below.
      await db.user.update({
        where: { id: userId },
        data: {
          banned: true,
          banReason: reason ?? "Suspended by administrator",
          status: "suspended",
        },
      });

      // Revoke all active sessions — delete from DB so next getSession() fails
      await db.session.deleteMany({
        where: { userId },
      });

      await writeAuditLog({
        actor_id: session.user.id,
        action: "ACCOUNT_SUSPEND",
        target_type: "user",
        target_id: userId,
        ip,
        user_agent: ua,
        result: "success",
        metadata: { reason: reason ?? "Suspended by administrator" },
      });

      return NextResponse.json({
        message: `User ${userId} suspended and all sessions revoked`,
      });
    }

    // ── UNSUSPEND ───────────────────────────────────────────────────
    if (body.action === "unsuspend") {
      const parsed = unsuspendAccountSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten() },
          { status: 400 },
        );
      }
      const { userId } = parsed.data;

      await db.user.update({
        where: { id: userId },
        data: {
          banned: false,
          banReason: null,
          banExpires: null,
          status: "active",
        },
      });

      await writeAuditLog({
        actor_id: session.user.id,
        action: "ACCOUNT_UNSUSPEND",
        target_type: "user",
        target_id: userId,
        ip,
        user_agent: ua,
        result: "success",
      });

      return NextResponse.json({
        message: `User ${userId} unsuspended`,
      });
    }

    // ── CHANGE ROLE ─────────────────────────────────────────────────
    if (body.action === "change-role") {
      const parsed = changeRoleSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten() },
          { status: 400 },
        );
      }
      const { userId, role } = parsed.data;

      const targetUser = await db.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (!targetUser) {
        console.warn("[manage-account] User not found for role change", {
          actorUserId: session.user.id,
          targetUserId: userId,
          action: "change-role",
          requestUrl: request.url,
        });
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      await db.user.update({
        where: { id: userId },
        data: { role },
      });

      await writeAuditLog({
        actor_id: session.user.id,
        action: "ROLE_CHANGE",
        target_type: "user",
        target_id: userId,
        ip,
        user_agent: ua,
        result: "success",
        metadata: { oldRole: targetUser.role, newRole: role },
      });

      return NextResponse.json({
        message: `User ${userId} role changed from ${targetUser.role} to ${role}`,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return NextResponse.json(
        { error: err.error ?? err.message },
        { status: err.status },
      );
    }
    console.error("[manage-account] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
