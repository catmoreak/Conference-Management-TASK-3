import { NextResponse } from "next/server";
import { getSession } from "~/server/better-auth/server";
import { db } from "~/server/db";
import { validateCsrf } from "~/server/auth/csrf";
import { assertRole } from "~/server/auth/rbac";
import { shadowCompare } from "~/server/auth/shadow-check";
import { requireRoleGrant } from "~/server/auth/authz/authorize";
import { PrismaAuthzStore } from "~/server/auth/authz/prisma-store";

const authzStore = new PrismaAuthzStore();

/**
 * GET /api/admin/sessions
 *
 * Lists all active sessions across the entire system.
 *
 * Security:
 *   - CSRF protection
 *   - Auth check
 *   - Admin role check
 */
export async function GET(request: Request) {
  try {
    // CSRF check
    validateCsrf(request);

    // Auth + Admin check
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = String((session.user as Record<string, unknown>).id);
    await shadowCompare({
      checkName: "admin/sessions:assertRole",
      actorId: userId,
      legacy: () => assertRole((session.user as Record<string, unknown>).role as string, "admin"),
      candidate: () => requireRoleGrant({ kind: "user", userId }, "system_admin", authzStore),
    });

    // Retrieve active sessions including user info
    const sessions = await db.session.findMany({
      include: {
        user: {
          select: {
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    const formatted = sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      email: s.user.email,
      name: s.user.name,
      role: s.user.role,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      expiresAt: s.expiresAt.toISOString(),
      lastActive: s.updatedAt.toISOString(),
    }));

    return NextResponse.json(formatted);
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return NextResponse.json(
        { error: err.error ?? err.message },
        { status: err.status },
      );
    }
    console.error("[GET /api/admin/sessions] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
