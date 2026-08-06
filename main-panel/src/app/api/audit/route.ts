import { NextResponse } from "next/server";
import { getSession } from "~/server/better-auth/server";
import { db } from "~/server/db";
import { validateCsrf } from "~/server/auth/csrf";
import { assertPermissions } from "~/server/auth/rbac";
import { shadowCompare } from "~/server/auth/shadow-check";
import { authorizeAndRun } from "~/server/auth/authz/authorize";
import { PrismaAuthzStore } from "~/server/auth/authz/prisma-store";

// Pilot call site for step 4 (see CUTOVER_GATE.md). One store instance,
// reused across requests -- it holds no per-request state.
const authzStore = new PrismaAuthzStore();

/**
 * GET /api/audit
 *
 * Lists and filters audit log events from the database.
 * Accessible to Administrators and Staff per the RBAC matrix.
 *
 * Query parameters:
 *   - actorId: filter by actor UUID
 *   - action: filter by action name (substring / match)
 *   - startDate: filter ISO occurred_at >= startDate
 *   - endDate: filter ISO occurred_at <= endDate
 *   - limit: maximum number of logs to return (default 50, max 200)
 */
export async function GET(request: Request) {
  try {
    // CSRF Check
    validateCsrf(request);

    // Auth & Permission check (requires dashboard/general or audit log viewing permissions)
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = session.user as Record<string, unknown>;
    const userId = String(user.id);

    // PILOT (step 4, CUTOVER_GATE.md gate not yet met -- legacy stays
    // authoritative). "dashboard:view" (legacy) has no equivalent in the
    // new catalogue -- it's mapped here to "audit:read", the closest match
    // for what this route actually does; the new catalogue's permissions
    // are more specific than the old blanket "can see the dashboard" one.
    // Expect mismatches until real users are backfilled into
    // user_role_assignments -- that backfill is a separate prerequisite
    // this pilot deliberately does not paper over; it's here to prove the
    // wiring and the mismatch-logging mechanism work, not to claim
    // agreement that doesn't exist yet.
    await shadowCompare({
      checkName: "audit/route:dashboard-view",
      actorId: userId,
      legacy: () => assertPermissions(user.role as string, "dashboard:view"),
      candidate: () =>
        authorizeAndRun({ kind: "user", userId }, "audit:read", null, authzStore, async () => true),
    });

    // Parse URL query parameters
    const { searchParams } = new URL(request.url);
    const actorId = searchParams.get("actorId");
    const action = searchParams.get("action");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const limitParam = searchParams.get("limit");

    const limit = limitParam ? Math.min(200, Math.max(1, parseInt(limitParam, 10))) : 50;

    // Build prisma query where filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (actorId) {
      where.actor_id = actorId;
    }

    if (action) {
      where.action = {
        contains: action,
        mode: "insensitive",
      };
    }

    if (startDate || endDate) {
      where.occurred_at = {};
      if (startDate) {
        where.occurred_at.gte = new Date(startDate);
      }
      if (endDate) {
        where.occurred_at.lte = new Date(endDate);
      }
    }

    const logs = await db.auditLog.findMany({
      where,
      orderBy: {
        occurred_at: "desc",
      },
      take: limit,
    });

    return NextResponse.json(logs);
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return NextResponse.json(
        { error: err.error ?? err.message },
        { status: err.status },
      );
    }
    console.error("[GET /api/audit] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
