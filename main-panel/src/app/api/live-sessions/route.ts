import { NextResponse } from "next/server";

import { env } from "~/env";
import { db } from "~/server/db";
import { getSession } from "~/server/better-auth/server";
import { assertPermissions } from "~/server/auth/rbac";
import { assertTenantAccess } from "~/server/auth/tenant";

/**
 * Authenticated live-session lookup for podium's "connect as display"
 * picker -- podium is a separate app/origin, mirrors /api/uploads'
 * CORS-allowlist pattern rather than same-origin CSRF (this is a GET,
 * read-only endpoint, so no CSRF concern, only CORS).
 */

function getOriginFromUrl(urlValue: string | null | undefined): string | null {
  if (!urlValue) return null;
  try {
    return new URL(urlValue).origin;
  } catch {
    return null;
  }
}

const allowedOrigins = new Set(
  [env.PODIUM_APP_URL, "http://localhost:5173", "http://127.0.0.1:5173"]
    .map(getOriginFromUrl)
    .filter((origin): origin is string => origin !== null),
);

function withCorsHeaders(response: NextResponse, request: Request): NextResponse {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.has(origin)) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Vary", "Origin");
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const headers = new Headers();
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  headers.set("Access-Control-Allow-Credentials", "true");
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return new Response(null, { status: 204, headers });
}

// GET /api/live-sessions?eventId=<uuid>
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return withCorsHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), request);
    }

    const user = session.user as Record<string, unknown>;
    assertPermissions(user.role as string | undefined, "live-control:view");

    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get("eventId");
    if (!eventId) {
      return withCorsHeaders(NextResponse.json({ error: "eventId is required" }, { status: 400 }), request);
    }

    const event = await db.event.findUnique({ where: { id: eventId } });
    if (!event) {
      return withCorsHeaders(NextResponse.json({ error: "Event not found" }, { status: 404 }), request);
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

    return withCorsHeaders(NextResponse.json({ liveSessions }), request);
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return withCorsHeaders(
        NextResponse.json({ error: err.error ?? err.message }, { status: err.status }),
        request,
      );
    }
    console.error("[live-sessions] Error:", error);
    return withCorsHeaders(NextResponse.json({ error: "Internal server error" }, { status: 500 }), request);
  }
}
