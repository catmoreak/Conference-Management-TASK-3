import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { env } from "~/env";
import { db } from "~/server/db";
import { getSession } from "~/server/better-auth/server";
import { assertPermissions } from "~/server/auth/rbac";
import { assertTenantAccess } from "~/server/auth/tenant";
import { assertOnboardingComplete } from "~/server/auth/mfa-gate";
import { validateCsrf } from "~/server/auth/csrf";
import { writeAuditLog, extractIp, extractUserAgent } from "~/server/auth/audit";
import {
  getPublicObjectUrl,
  isS3Configured,
  uploadObjectToS3,
} from "~/server/storage/s3-client";
import { MAX_UPLOAD_BYTES, detectFileKind, isExtensionConsistent, checkZipBomb } from "~/server/storage/file-validation";
import { buildAllowedOrigins, getOriginFromUrl, isAllowedOrigin, withCorsHeaders } from "~/server/http/cors";

/**
 * Session-scoped presentation file manager -- backs the "Session Files"
 * panel in both main-panel (/dashboard/files) and podium (dashboard). This
 * is deliberately separate from the check-in kiosk's presenter-submission
 * workflow (submission.approve/reject): files added here are created
 * already-approved because an admin/reviewer is uploading them directly,
 * with no presenter review step to gate on. Both flows share the
 * `submissions` table (and its objectKey/fileName/sortOrder columns) so a
 * single ordered list serves the live-control file picker either way.
 */

const allowedOrigins = buildAllowedOrigins(env.PODIUM_APP_URL, env.BETTER_AUTH_URL);

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^\w.\-]/g, "_");
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const requestedHeaders =
    request.headers.get("access-control-request-headers") ?? "content-type,authorization";

  const resHeaders = new Headers();
  resHeaders.set("Vary", "Origin, Access-Control-Request-Headers");
  resHeaders.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  resHeaders.set("Access-Control-Allow-Headers", requestedHeaders);
  resHeaders.set("Access-Control-Allow-Credentials", "true");
  if (isAllowedOrigin(origin, allowedOrigins)) {
    resHeaders.set("Access-Control-Allow-Origin", origin);
  }
  return new Response(null, { status: 204, headers: resHeaders });
}

async function loadSessionWithTenantCheck(
  liveSessionId: string,
  session: Awaited<ReturnType<typeof getSession>>,
) {
  const liveSession = await db.liveSession.findUnique({
    where: { id: liveSessionId },
    include: { event: true },
  });
  if (!liveSession || liveSession.deletedAt) {
    throw { status: 404, error: "Live session not found" };
  }
  assertTenantAccess(session!, liveSession.event.tenantId, true);
  return liveSession;
}

// GET /api/live-sessions/[id]/files -- ordered list of files for a session
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return withCorsHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), request, allowedOrigins);
    }
    const user = session.user as Record<string, unknown>;
    assertPermissions(user.role as string | undefined, "material:view");

    const { id } = await params;
    const liveSession = await loadSessionWithTenantCheck(id, session);

    const files = await db.submission.findMany({
      where: { liveSessionId: liveSession.id, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        fileName: true,
        fileSize: true,
        contentType: true,
        publicUrl: true,
        objectKey: true,
        status: true,
        sortOrder: true,
        createdBy: true,
        createdAt: true,
        itemType: true,
        coverText: true,
        presenter: { select: { id: true, displayName: true } },
      } as any,
    });

    // Resolve uploader display names in one query rather than N+1.
    const uploaderIds = [...new Set((files as any[]).map((f) => f.createdBy).filter((id): id is string => Boolean(id)))];
    const uploaders = await db.user.findMany({
      where: { id: { in: uploaderIds } },
      select: { id: true, name: true },
    });
    const uploaderNameById = new Map(uploaders.map((u) => [u.id, u.name]));

    return withCorsHeaders(
      NextResponse.json({
        files: files.map((f) => ({
          id: f.id,
          fileName: f.fileName,
          fileSize: f.fileSize,
          contentType: f.contentType,
          publicUrl: f.publicUrl,
          status: f.status,
          sortOrder: f.sortOrder,
          uploadedBy: uploaderNameById.get(String((f as any).createdBy)) ?? "Unknown",
          uploadedAt: f.createdAt,
          presenter: f.presenter,
          itemType: (f as any).itemType,
          coverText: (f as any).coverText,
        })),
      }),
      request,
      allowedOrigins,
    );
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return withCorsHeaders(NextResponse.json({ error: err.error ?? err.message }, { status: err.status }), request, allowedOrigins);
    }
    console.error("[live-sessions/files] GET error:", error);
    return withCorsHeaders(NextResponse.json({ error: "Internal server error" }, { status: 500 }), request, allowedOrigins);
  }
}

// POST /api/live-sessions/[id]/files -- direct upload by admin/reviewer.
// Skips the presenter check-in review workflow: the uploader IS the
// reviewer/admin, so the file is created already "approved".
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
    const liveSession = await loadSessionWithTenantCheck(id, session);

    if (!isS3Configured()) {
      return withCorsHeaders(
        NextResponse.json({ error: "Storage not configured" }, { status: 501 }),
        request,
        allowedOrigins,
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return withCorsHeaders(NextResponse.json({ error: "file is required" }, { status: 400 }), request, allowedOrigins);
    }
    if (file.size <= 0) {
      return withCorsHeaders(NextResponse.json({ error: "file is empty" }, { status: 400 }), request, allowedOrigins);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return withCorsHeaders(
        NextResponse.json({ error: `file too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB)` }, { status: 413 }),
        request,
        allowedOrigins,
      );
    }

    const claimedExt = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (![".pptx", ".pptm", ".ppt", ".pdf"].includes(claimedExt)) {
      return withCorsHeaders(
        NextResponse.json({ error: "Only PowerPoint (.ppt/.pptx/.pptm) or PDF files are accepted" }, { status: 400 }),
        request,
        allowedOrigins,
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const kind = detectFileKind(fileBuffer);
    if (kind !== "unknown" && !isExtensionConsistent(file.name, kind)) {
      return withCorsHeaders(
        NextResponse.json({ error: "File content does not match its extension" }, { status: 400 }),
        request,
        allowedOrigins,
      );
    }
    if (kind === "pptx") {
      const bombCheck = checkZipBomb(fileBuffer);
      if (!bombCheck.safe) {
        return withCorsHeaders(
          NextResponse.json({ error: `File rejected: ${bombCheck.reason}` }, { status: 400 }),
          request,
          allowedOrigins,
        );
      }
    }

    const tenantId = liveSession.event.tenantId;
    const fileId = crypto.randomUUID();
    const randomId = crypto.randomUUID();
    const objectKey = `${tenantId}/original/${fileId}/${randomId}-${sanitizeFileName(file.name)}`;

    const uploaded = await uploadObjectToS3({
      objectKey,
      body: fileBuffer,
      contentType: file.type || "application/octet-stream",
      metadata: { uploader_id: String(session.user.id), source: "session-file-manager" },
    });

    const maxOrder = await db.submission.aggregate({
      where: { liveSessionId: liveSession.id, deletedAt: null },
      _max: { sortOrder: true },
    });

    const created = await db.submission.create({
      data: {
        id: fileId,
        eventId: liveSession.eventId,
        liveSessionId: liveSession.id,
        ownerId: String(session.user.id),
        createdBy: String(session.user.id),
        status: "approved",
        reviewedAt: new Date(),
        reviewedBy: String(session.user.id),
        objectKey: uploaded.objectKey,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || "application/octet-stream",
        publicUrl: getPublicObjectUrl(uploaded.objectKey),
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      },
    });

    const reqHeaders = await headers();
    await writeAuditLog({
      actor_id: session.user.id,
      action: "SESSION_FILE_UPLOAD",
      target_type: "submission",
      target_id: created.id,
      ip: extractIp(reqHeaders),
      user_agent: extractUserAgent(reqHeaders),
      result: "success",
      metadata: { liveSessionId: liveSession.id, fileName: file.name, fileSize: file.size },
    });

    return withCorsHeaders(
      NextResponse.json({
        success: true,
        file: {
          id: created.id,
          fileName: created.fileName,
          fileSize: created.fileSize,
          contentType: created.contentType,
          publicUrl: created.publicUrl,
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
    console.error("[live-sessions/files] POST error:", error);
    return withCorsHeaders(NextResponse.json({ error: "Internal server error" }, { status: 500 }), request, allowedOrigins);
  }
}
