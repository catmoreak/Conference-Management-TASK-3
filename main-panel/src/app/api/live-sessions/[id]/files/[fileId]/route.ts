import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { env } from "~/env";
import { db } from "~/server/db";
import { getSession } from "~/server/better-auth/server";
import { assertPermissions } from "~/server/auth/rbac";
import { assertTenantAccess } from "~/server/auth/tenant";
import { validateCsrf } from "~/server/auth/csrf";
import { writeAuditLog, extractIp, extractUserAgent } from "~/server/auth/audit";
import { buildAllowedOrigins, getOriginFromUrl, isAllowedOrigin, withCorsHeaders } from "~/server/http/cors";

const allowedOrigins = buildAllowedOrigins(env.PODIUM_APP_URL, env.BETTER_AUTH_URL);

const renameSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255).optional(),
    coverText: z.string().trim().min(1).max(200).optional(),
  })
  .refine((data) => (data.fileName != null) !== (data.coverText != null), {
    message: "Provide exactly one of fileName or coverText",
  });

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const requestedHeaders =
    request.headers.get("access-control-request-headers") ?? "content-type,authorization";

  const resHeaders = new Headers();
  resHeaders.set("Vary", "Origin, Access-Control-Request-Headers");
  resHeaders.set("Access-Control-Allow-Methods", "PATCH,DELETE,OPTIONS");
  resHeaders.set("Access-Control-Allow-Headers", requestedHeaders);
  resHeaders.set("Access-Control-Allow-Credentials", "true");
  if (isAllowedOrigin(origin, allowedOrigins)) {
    resHeaders.set("Access-Control-Allow-Origin", origin);
  }
  return new Response(null, { status: 204, headers: resHeaders });
}

async function loadFileWithTenantCheck(
  liveSessionId: string,
  fileId: string,
  session: Awaited<ReturnType<typeof getSession>>,
) {
  const file = await db.submission.findUnique({
    where: { id: fileId },
    include: { event: true },
  });
  if (!file || file.deletedAt || file.liveSessionId !== liveSessionId) {
    throw { status: 404, error: "File not found" };
  }
  assertTenantAccess(session!, file.event.tenantId, true);
  return file;
}

function validateOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !isAllowedOrigin(origin, allowedOrigins)) {
    throw { status: 403, error: "Forbidden origin" };
  }
  if (!origin || getOriginFromUrl(env.BETTER_AUTH_URL) === origin) {
    validateCsrf(request);
  }
}

// PATCH /api/live-sessions/[id]/files/[fileId] -- rename (admin only)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    validateOrigin(request);

    const session = await getSession();
    if (!session?.user) {
      return withCorsHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), request, allowedOrigins);
    }
    const user = session.user as Record<string, unknown>;
    assertPermissions(user.role as string | undefined, "material:rename");

    const { id, fileId } = await params;
    const existing = await loadFileWithTenantCheck(id, fileId, session);

    const body: unknown = await request.json();
    const parsed = renameSchema.safeParse(body);
    if (!parsed.success) {
      return withCorsHeaders(
        NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 }),
        request,
        allowedOrigins,
      );
    }

    const isCover = (existing as { itemType?: string }).itemType === "cover";
    if (isCover !== (parsed.data.coverText != null)) {
      return withCorsHeaders(
        NextResponse.json({ error: isCover ? "This item is a cover slide; provide coverText" : "This item is a file; provide fileName" }, { status: 400 }),
        request,
        allowedOrigins,
      );
    }

    const updated = await db.submission.update({
      where: { id: fileId },
      data: (isCover ? { coverText: parsed.data.coverText } : { fileName: parsed.data.fileName }) as any,
    });

    const reqHeaders = await headers();
    await writeAuditLog({
      actor_id: session.user.id,
      action: isCover ? "SESSION_COVER_RENAME" : "SESSION_FILE_RENAME",
      target_type: "submission",
      target_id: fileId,
      ip: extractIp(reqHeaders),
      user_agent: extractUserAgent(reqHeaders),
      result: "success",
      metadata: isCover ? { newCoverText: parsed.data.coverText } : { newFileName: parsed.data.fileName },
    });

    return withCorsHeaders(
      NextResponse.json({ success: true, file: { id: updated.id, fileName: updated.fileName, coverText: (updated as any).coverText } }),
      request,
      allowedOrigins,
    );
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return withCorsHeaders(NextResponse.json({ error: err.error ?? err.message }, { status: err.status }), request, allowedOrigins);
    }
    console.error("[live-sessions/files/[fileId]] PATCH error:", error);
    return withCorsHeaders(NextResponse.json({ error: "Internal server error" }, { status: 500 }), request, allowedOrigins);
  }
}

// DELETE /api/live-sessions/[id]/files/[fileId] -- admin/reviewer only
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    validateOrigin(request);

    const session = await getSession();
    if (!session?.user) {
      return withCorsHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), request, allowedOrigins);
    }
    const user = session.user as Record<string, unknown>;
    assertPermissions(user.role as string | undefined, "material:delete");

    const { id, fileId } = await params;
    await loadFileWithTenantCheck(id, fileId, session);

    await db.submission.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });

    const reqHeaders = await headers();
    await writeAuditLog({
      actor_id: session.user.id,
      action: "SESSION_FILE_DELETE",
      target_type: "submission",
      target_id: fileId,
      ip: extractIp(reqHeaders),
      user_agent: extractUserAgent(reqHeaders),
      result: "success",
    });

    return withCorsHeaders(NextResponse.json({ success: true }), request, allowedOrigins);
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return withCorsHeaders(NextResponse.json({ error: err.error ?? err.message }, { status: err.status }), request, allowedOrigins);
    }
    console.error("[live-sessions/files/[fileId]] DELETE error:", error);
    return withCorsHeaders(NextResponse.json({ error: "Internal server error" }, { status: 500 }), request, allowedOrigins);
  }
}
