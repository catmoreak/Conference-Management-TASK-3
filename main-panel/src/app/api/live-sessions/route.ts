import { NextResponse } from "next/server";

import { env } from "~/env";
import { db } from "~/server/db";
import { getSession } from "~/server/better-auth/server";
import { assertPermissions } from "~/server/auth/rbac";
import { assertTenantAccess } from "~/server/auth/tenant";
import { buildAllowedOrigins, isAllowedOrigin, withCorsHeaders } from "~/server/http/cors";

/**
 * Authenticated live-session lookup for podium's "connect as display"
 * picker -- podium is a separate app/origin, mirrors /api/uploads'
 * CORS-allowlist pattern rather than same-origin CSRF (this is a GET,
 * read-only endpoint, so no CSRF concern, only CORS).
 */

const allowedOrigins = buildAllowedOrigins(env.PODIUM_APP_URL);

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const headers = new Headers();
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  headers.set("Access-Control-Allow-Credentials", "true");
  if (isAllowedOrigin(origin, allowedOrigins)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return new Response(null, { status: 204, headers });
}

// GET /api/live-sessions?eventId=<uuid>
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return withCorsHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), request, allowedOrigins);
    }

    const user = session.user as Record<string, unknown>;
    assertPermissions(user.role as string | undefined, "live-control:view");

    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get("eventId");
    if (!eventId) {
      return withCorsHeaders(
        NextResponse.json({ error: "eventId is required" }, { status: 400 }),
        request,
        allowedOrigins,
      );
    }

    const event = await db.event.findUnique({ where: { id: eventId } });
    if (!event) {
      return withCorsHeaders(NextResponse.json({ error: "Event not found" }, { status: 404 }), request, allowedOrigins);
    }
    assertTenantAccess(session, event.tenantId, true);

    const liveSessions = await db.liveSession.findMany({
      where: { eventId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { startsAt: "asc" }],
      select: {
        id: true,
        name: true,
        status: true,
        room: { select: { name: true } },
      },
    });

    return withCorsHeaders(NextResponse.json({ liveSessions }), request, allowedOrigins);
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return withCorsHeaders(
        NextResponse.json({ error: err.error ?? err.message }, { status: err.status }),
        request,
        allowedOrigins,
      );
    }
    console.error("[live-sessions] Error:", error);
    return withCorsHeaders(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      request,
      allowedOrigins,
    );
  }
}
