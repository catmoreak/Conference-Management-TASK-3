import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "~/env";
import { db } from "~/server/db";
import { getSession } from "~/server/better-auth/server";
import { assertPermissions } from "~/server/auth/rbac";
import { assertTenantAccess } from "~/server/auth/tenant";
import { validateCsrf } from "~/server/auth/csrf";
import { buildAllowedOrigins, getOriginFromUrl, isAllowedOrigin, withCorsHeaders } from "~/server/http/cors";

/**
 * Bulk reorder endpoint for a live session's file list. Split out from
 * PATCH /files/[fileId] (which only renames) because reorder is a distinct
 * permission (admin + reviewer + presenter can all reorder, but only admin
 * can rename) and operates on the whole ordered list at once, not one file.
 */

const allowedOrigins = buildAllowedOrigins(env.PODIUM_APP_URL, env.BETTER_AUTH_URL);

const reorderSchema = z.object({
  order: z.array(z.string().min(1)).min(1),
});

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const requestedHeaders =
    request.headers.get("access-control-request-headers") ?? "content-type,authorization";

  const resHeaders = new Headers();
  resHeaders.set("Vary", "Origin, Access-Control-Request-Headers");
  resHeaders.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  resHeaders.set("Access-Control-Allow-Headers", requestedHeaders);
  resHeaders.set("Access-Control-Allow-Credentials", "true");
  if (isAllowedOrigin(origin, allowedOrigins)) {
    resHeaders.set("Access-Control-Allow-Origin", origin);
  }
  return new Response(null, { status: 204, headers: resHeaders });
}

// POST /api/live-sessions/[id]/files/reorder  { order: string[] }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const origin = request.headers.get("origin");
    if (origin && !isAllowedOrigin(origin, allowedOrigins)) {
      return withCorsHeaders(NextResponse.json({ error: "Forbidden origin" }, { status: 403 }), request, allowedOrigins);
    }
    if (!origin || getOriginFromUrl(env.BETTER_AUTH_URL) === origin) {
      validateCsrf(request);
    }

    const session = await getSession();
    if (!session?.user) {
      return withCorsHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), request, allowedOrigins);
    }
    const user = session.user as Record<string, unknown>;
    assertPermissions(user.role as string | undefined, "material:reorder");

    const { id } = await params;
    const liveSession = await db.liveSession.findUnique({ where: { id }, include: { event: true } });
    if (!liveSession || liveSession.deletedAt) {
      return withCorsHeaders(NextResponse.json({ error: "Live session not found" }, { status: 404 }), request, allowedOrigins);
    }
    assertTenantAccess(session, liveSession.event.tenantId, true);

    const body: unknown = await request.json();
    const parsed = reorderSchema.safeParse(body);
    if (!parsed.success) {
      return withCorsHeaders(
        NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 }),
        request,
        allowedOrigins,
      );
    }

    // Verify every id in the requested order actually belongs to this
    // session before writing anything, so a malformed/foreign id can't
    // silently reorder or leak into another session's file list.
    const existing = await db.submission.findMany({
      where: { liveSessionId: liveSession.id, deletedAt: null },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((f) => f.id));
    const requestedIds = parsed.data.order;
    if (requestedIds.length !== existingIds.size || requestedIds.some((fid) => !existingIds.has(fid))) {
      return withCorsHeaders(
        NextResponse.json({ error: "order must contain exactly the current set of file ids for this session" }, { status: 400 }),
        request,
        allowedOrigins,
      );
    }

    await db.$transaction(
      requestedIds.map((fileId, index) =>
        db.submission.update({ where: { id: fileId }, data: { sortOrder: index } }),
      ),
    );

    return withCorsHeaders(NextResponse.json({ success: true }), request, allowedOrigins);
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return withCorsHeaders(NextResponse.json({ error: err.error ?? err.message }, { status: err.status }), request, allowedOrigins);
    }
    console.error("[live-sessions/files/reorder] POST error:", error);
    return withCorsHeaders(NextResponse.json({ error: "Internal server error" }, { status: 500 }), request, allowedOrigins);
  }
}
