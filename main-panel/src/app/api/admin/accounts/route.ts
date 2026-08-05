import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSession } from "~/server/better-auth/server";
import { db } from "~/server/db";
import { validateCsrf } from "~/server/auth/csrf";
import { assertRole } from "~/server/auth/rbac";

/**
 * GET /api/admin/accounts
 *
 * Lists all Administrator, Staff, and Presentation Operations Staff accounts
 * with their role, status, tenantId, mustResetPassword, and last active timestamp.
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

    // Auth + Admin role check
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertRole((session.user as Record<string, unknown>).role as string, "admin");

    // Fetch users with relevant fields
    const users = await db.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        tenantId: true,
        mustResetPassword: true,
        twoFactorEnabled: true,
        createdAt: true,
        sessions: {
          select: {
            updatedAt: true,
          },
          orderBy: {
            updatedAt: "desc",
          },
          take: 1,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Format output to include lastLogin
    const formatted = users.map((u) => {
      const lastSession = u.sessions[0];
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        tenantId: u.tenantId,
        mustResetPassword: u.mustResetPassword,
        twoFactorEnabled: u.twoFactorEnabled,
        createdAt: u.createdAt,
        lastLogin: lastSession ? lastSession.updatedAt.toISOString() : null,
      };
    });

    return NextResponse.json(formatted);
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return NextResponse.json(
        { error: err.error ?? err.message },
        { status: err.status },
      );
    }
    console.error("[GET /api/admin/accounts] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
