import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { env } from "~/env";
import { getSession } from "~/server/better-auth/server";
import { writeAuditLog, extractIp, extractUserAgent } from "~/server/auth/audit";
import { validateCsrf } from "~/server/auth/csrf";
import { assertPermissions } from "~/server/auth/rbac";
import { assertOnboardingComplete } from "~/server/auth/mfa-gate";
import {
  getPublicObjectUrl,
  isS3Configured,
  uploadObjectToS3,
} from "~/server/storage/s3-client";
import { MAX_UPLOAD_BYTES, detectFileKind, isExtensionConsistent, checkZipBomb } from "~/server/storage/file-validation";
import { buildAllowedOrigins, getOriginFromUrl, withCorsHeaders } from "~/server/http/cors";

const allowedOrigins = buildAllowedOrigins(env.PODIUM_APP_URL, env.BETTER_AUTH_URL);

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^\w.\-]/g, "_");
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const requestedHeaders =
    request.headers.get("access-control-request-headers") ??
    "content-type,authorization";

  const headers = new Headers();
  headers.set("Vary", "Origin, Access-Control-Request-Headers");
  headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", requestedHeaders);
  headers.set("Access-Control-Allow-Credentials", "true");

  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return new Response(null, { status: 204, headers });
}

export async function POST(request: Request) {
  try {
    // Same posture as /api/ws/token: podium (a separate app/origin) calls
    // this route cross-origin, so an explicit allowlist substitutes for the
    // strict same-origin check there. Same-origin calls (the pres-ops
    // dashboard itself) still go through validateCsrf().
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigins.has(origin)) {
      return withCorsHeaders(
        NextResponse.json({ error: "Forbidden origin" }, { status: 403 }),
        request,
        allowedOrigins,
      );
    }
    if (!origin || getOriginFromUrl(env.BETTER_AUTH_URL) === origin) {
      validateCsrf(request);
    }

    const session = await getSession();
    if (!session?.user) {
      return withCorsHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        request,
        allowedOrigins,
      );
    }

    const user = session.user as Record<string, unknown>;
    assertOnboardingComplete({
      user: {
        twoFactorEnabled: user.twoFactorEnabled as boolean | null | undefined,
        mustResetPassword: user.mustResetPassword as boolean | undefined,
      },
    });

    assertPermissions(user.role as string | undefined, "material:upload");

    if (!isS3Configured()) {
      return withCorsHeaders(
        NextResponse.json(
          {
            error: "Storage not configured",
            message:
              "Set S3_ENDPOINT and S3_BUCKET on the server. Credentials can come from S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY or AWS default credential chain.",
          },
          { status: 501 },
        ),
        request,
        allowedOrigins,
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return withCorsHeaders(
        NextResponse.json({ error: "file is required" }, { status: 400 }),
        request,
        allowedOrigins,
      );
    }

    if (file.size <= 0) {
      return withCorsHeaders(
        NextResponse.json({ error: "file is empty" }, { status: 400 }),
        request,
        allowedOrigins,
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return withCorsHeaders(
        NextResponse.json(
          { error: `file too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB)` },
          { status: 413 },
        ),
        request,
        allowedOrigins,
      );
    }

    const tenantId = typeof user.tenantId === "string" && user.tenantId ? user.tenantId : "global";
    const fileId = crypto.randomUUID();
    const randomId = crypto.randomUUID();
    const objectKey = `${tenantId}/original/${fileId}/${randomId}-${sanitizeFileName(file.name)}`;

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Magic-number spoofing check: only enforced for filenames that claim to
    // be one of the recognised presentation/PDF formats. We intentionally
    // allow files whose type we cannot detect (kind === "unknown") -- some
    // legitimate PPTX files (e.g. encrypted/password-protected files,
    // certain Google Slides / LibreOffice exports) use non-standard headers
    // that our sniffer cannot fingerprint. We only hard-block when we
    // *positively* identify a mismatch (e.g. PDF bytes with a .pptx extension).
    const claimedExt = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if ([".pptx", ".pptm", ".ppt", ".pdf"].includes(claimedExt)) {
      const kind = detectFileKind(fileBuffer);
      if (kind !== "unknown" && !isExtensionConsistent(file.name, kind)) {
        return withCorsHeaders(
          NextResponse.json(
            { error: "File content does not match its extension" },
            { status: 400 },
          ),
          request,
          allowedOrigins,
        );
      }

      // ZIP-bomb check for PPTX/PPTM files
      if (kind === "pptx") {
        const bombCheck = checkZipBomb(fileBuffer);
        if (!bombCheck.safe) {
          return withCorsHeaders(
            NextResponse.json(
              { error: `File rejected: ${bombCheck.reason}` },
              { status: 400 },
            ),
            request,
            allowedOrigins,
          );
        }
      }
    }

    const uploaded = await uploadObjectToS3({
      objectKey,
      body: fileBuffer,
      contentType: file.type || "application/octet-stream",
      metadata: {
        uploader_id: String(session.user.id),
        source: "podium",
      },
    });

    const reqHeaders = await headers();
    await writeAuditLog({
      actor_id: session.user.id,
      action: "FILE_UPLOAD",
      target_type: "file",
      target_id: fileId,
      ip: extractIp(reqHeaders),
      user_agent: extractUserAgent(reqHeaders),
      result: "success",
      metadata: {
        objectKey,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || "application/octet-stream",
      },
    });

    return withCorsHeaders(
      NextResponse.json(
        {
          success: true,
          fileId,
          objectKey: uploaded.objectKey,
          publicUrl: getPublicObjectUrl(uploaded.objectKey),
          bucket: uploaded.bucket,
          etag: uploaded.etag ?? null,
          fileName: file.name,
          size: file.size,
        },
        { status: 200 },
      ),
      request,
      allowedOrigins,
    );
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return withCorsHeaders(
        NextResponse.json({ error: err.error ?? err.message }, { status: err.status }),
        request,
        allowedOrigins,
      );
    }

    console.error("[uploads] Error:", error);
    return withCorsHeaders(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      request,
      allowedOrigins,
    );
  }
}
