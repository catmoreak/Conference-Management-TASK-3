import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { env } from "~/env";
import { db } from "~/server/db";
import { getSession } from "~/server/better-auth/server";
import { assertPermissions } from "~/server/auth/rbac";
import { assertTenantAccess } from "~/server/auth/tenant";
import { assertOnboardingComplete } from "~/server/auth/mfa-gate";
import { validateCsrf } from "~/server/auth/csrf";
import { writeAuditLog, extractIp, extractUserAgent } from "~/server/auth/audit";
import { buildAllowedOrigins, getOriginFromUrl, isAllowedOrigin, withCorsHeaders } from "~/server/http/cors";

/**
 * Creates a lightweight "cover" item in a live session's file list -- a
 * plain-text interstitial slide (e.g. the event name) with no uploaded
 * file, used to fill the screen between two real presentations. Shares the
 * `submissions` table/sortOrder with real files (see files/route.ts) so it
 * slots into the same ordered, reorderable, deletable list.
 */

const allowedOrigins = buildAllowedOrigins(env.PODIUM_APP_URL, env.BETTER_AUTH_URL);

const createCoverSchema = z.object({
  coverText: z.string().trim().min(1).max(200),
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

// POST /api/live-sessions/[id]/files/cover -- create a cover item (admin/reviewer)
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
    assertOnboardingComplete({
      user: {
        twoFactorEnabled: user.twoFactorEnabled as boolean | null | undefined,
        mustResetPassword: user.mustResetPassword as boolean | undefined,
      },
    });
    assertPermissions(user.role as string | undefined, "material:upload");

    const { id } = await params;
    const liveSession = await db.liveSession.findUnique({ where: { id }, include: { event: true } });
    if (!liveSession || liveSession.deletedAt) {
      return withCorsHeaders(NextResponse.json({ error: "Live session not found" }, { status: 404 }), request, allowedOrigins);
    }
    assertTenantAccess(session, liveSession.event.tenantId, true);

    const body: unknown = await request.json();
    const parsed = createCoverSchema.safeParse(body);
    if (!parsed.success) {
      return withCorsHeaders(
        NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 }),
        request,
        allowedOrigins,
      );
    }

    const maxOrder = await db.submission.aggregate({
      where: { liveSessionId: liveSession.id, deletedAt: null },
      _max: { sortOrder: true },
    });

    const created = await db.submission.create({
      data: {
        eventId: liveSession.eventId,
        liveSessionId: liveSession.id,
        ownerId: String(session.user.id),
        createdBy: String(session.user.id),
        status: "approved",
        reviewedAt: new Date(),
        reviewedBy: String(session.user.id),
        itemType: "cover",
        coverText: parsed.data.coverText,
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      } as any,
    });

    const reqHeaders = await headers();
    await writeAuditLog({
      actor_id: session.user.id,
      action: "SESSION_COVER_CREATE",
      target_type: "submission",
      target_id: created.id,
      ip: extractIp(reqHeaders),
      user_agent: extractUserAgent(reqHeaders),
      result: "success",
      metadata: { liveSessionId: liveSession.id, coverText: parsed.data.coverText },
    });

    return withCorsHeaders(
      NextResponse.json({
        success: true,
        file: {
          id: created.id,
          itemType: (created as any).itemType,
          coverText: (created as any).coverText,
          status: created.status,
          sortOrder: created.sortOrder,
          uploadedBy: session.user.name,
          uploadedAt: created.createdAt,
        },
      }),
      request,
      allowedOrigins,
    );
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return withCorsHeaders(NextResponse.json({ error: err.error ?? err.message }, { status: err.status }), request, allowedOrigins);
    }
    console.error("[live-sessions/files/cover] POST error:", error);
    return withCorsHeaders(NextResponse.json({ error: "Internal server error" }, { status: 500 }), request, allowedOrigins);
  }
}
