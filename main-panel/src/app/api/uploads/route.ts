import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { env } from "~/env";
import { getSession } from "~/server/better-auth/server";
import { writeAuditLog, extractIp, extractUserAgent } from "~/server/auth/audit";
import { assertPermissions } from "~/server/auth/rbac";
import { assertOnboardingComplete } from "~/server/auth/mfa-gate";
import {
  getPublicObjectUrl,
  isS3Configured,
  uploadObjectToS3,
} from "~/server/storage/s3-client";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB

function getOriginFromUrl(urlValue: string | null | undefined): string | null {
  if (!urlValue) {
    return null;
  }
  try {
    return new URL(urlValue).origin;
  } catch {
    return null;
  }
}

const allowedOrigins = new Set(
  [
    env.PODIUM_APP_URL,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    env.BETTER_AUTH_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ]
    .map(getOriginFromUrl)
    .filter((origin): origin is string => origin !== null),
);

function appendVaryHeader(headers: Headers, value: string): void {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", value);
    return;
  }

  if (!current.split(",").map((part) => part.trim().toLowerCase()).includes(value.toLowerCase())) {
    headers.set("Vary", `${current}, ${value}`);
  }
}

function withCorsHeaders(response: NextResponse, request: Request): NextResponse {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.has(origin)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  appendVaryHeader(headers, "Origin");

  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

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
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigins.has(origin)) {
      return withCorsHeaders(
        NextResponse.json({ error: "Forbidden origin" }, { status: 403 }),
        request,
      );
    }

    const session = await getSession();
    if (!session?.user) {
      return withCorsHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        request,
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
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return withCorsHeaders(
        NextResponse.json({ error: "file is required" }, { status: 400 }),
        request,
      );
    }

    if (file.size <= 0) {
      return withCorsHeaders(
        NextResponse.json({ error: "file is empty" }, { status: 400 }),
        request,
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return withCorsHeaders(
        NextResponse.json(
          { error: `file too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB)` },
          { status: 413 },
        ),
        request,
      );
    }

    const tenantId = String(user.tenantId ?? "global");
    const fileId = crypto.randomUUID();
    const randomId = crypto.randomUUID();
    const objectKey = `${tenantId}/original/${fileId}/${randomId}-${sanitizeFileName(file.name)}`;

    const fileBuffer = Buffer.from(await file.arrayBuffer());
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
    );
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return withCorsHeaders(
        NextResponse.json({ error: err.error ?? err.message }, { status: err.status }),
        request,
      );
    }

    console.error("[uploads] Error:", error);
    return withCorsHeaders(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      request,
    );
  }
}
