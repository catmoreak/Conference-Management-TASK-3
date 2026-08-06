import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { getSession } from "~/server/better-auth/server";
import { writeAuditLog, extractIp, extractUserAgent } from "~/server/auth/audit";
import { validateCsrf } from "~/server/auth/csrf";
import { assertPermissions } from "~/server/auth/rbac";
import { assertOnboardingComplete } from "~/server/auth/mfa-gate";
import {
  getPresignedDownloadUrl,
  isS3Configured,
  type FileType,
} from "~/server/storage/s3-client";
import { shadowCompare } from "~/server/auth/shadow-check";
import { authorizeAndRun } from "~/server/auth/authz/authorize";
import { PrismaAuthzStore } from "~/server/auth/authz/prisma-store";
import { PRESIGNED_URL_TTL_SECONDS } from "~/server/auth/authz/presign-policy";

const authzStore = new PrismaAuthzStore();

// ── Input validation ─────────────────────────────────────────────────────

const downloadRequestSchema = z.object({
  fileType: z.enum(["original", "display_package"]),
  fileId: z.string().min(1, "fileId is required"),
  fileName: z.string().min(1, "fileName is required"),
  /** S3 object key (optional — required when S3 is configured). */
  objectKey: z.string().optional(),
});

// ── Route handler ────────────────────────────────────────────────────────

/**
 * POST /api/downloads
 *
 * Authenticated endpoint that issues short-lived presigned download URLs
 * for Original Files or Display Packages. The URL expires in
 * PRESIGNED_URL_TTL_SECONDS (300s) and is single-purpose (one file,
 * one GetObject action).
 *
 * Security:
 *   - Requires valid Better Auth session cookie
 *   - Enforces onboarding gates (password reset + MFA)
 *   - RBAC: requires "material:download" permission
 *   - Additional check: pres_ops_staff cannot download "original" files
 *   - CSRF validation for the POST request
 *   - Every download request is logged to AuditLog
 *   - Presigned URLs expire quickly and are scoped to one S3 object
 *
 * Request body:
 *   {
 *     fileType: "original" | "display_package",
 *     fileId: string,
 *     fileName: string,
 *     objectKey?: string
 *   }
 *
 * Response:
 *   { url: string, expiresIn: number }
 *   or 501 if S3 is not configured
 */
export async function POST(request: Request) {
  try {
    // ── CSRF ─────────────────────────────────────────────────────────
    validateCsrf(request);

    // ── Authentication ───────────────────────────────────────────────
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const user = session.user as Record<string, unknown>;

    // ── Onboarding gates ─────────────────────────────────────────────
    assertOnboardingComplete({
      user: {
        twoFactorEnabled: user.twoFactorEnabled as boolean | null | undefined,
        mustResetPassword: user.mustResetPassword as boolean | undefined,
      },
    });

    // ── RBAC ─────────────────────────────────────────────────────────
    const role = user.role as string | undefined;
    const userId = String(session.user.id);
    // material:download -> submission:download: confirmed equivalence (not
    // assumed) -- see the material/submission gap analysis. resource=null:
    // this route's fileId comes from a stubbed S3 flow with no Submission
    // row to resolve yet, so only a global-scope grant can satisfy this,
    // same as audit/route.ts's audit:read.
    await shadowCompare({
      checkName: "downloads:material-download",
      actorId: userId,
      legacy: () => assertPermissions(role, "material:download"),
      candidate: () =>
        authorizeAndRun({ kind: "user", userId }, "submission:download", null, authzStore, async () => true),
    });

    // ── Input validation ─────────────────────────────────────────────
    const body: unknown = await request.json();
    const parsed = downloadRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { fileType, fileId, fileName, objectKey } = parsed.data;

    // ── Role-specific restriction ────────────────────────────────────
    // pres_ops_staff can view/download display packages but NOT originals
    if (fileType === "original" && role === "pres_ops_staff") {
      return NextResponse.json(
        { error: "Presentation operations staff cannot download original files" },
        { status: 403 },
      );
    }

    // ── S3 availability check ────────────────────────────────────────
    if (!isS3Configured()) {
      // Audit the attempt even if we can't fulfill it
      const reqHeaders = await headers();
      await writeAuditLog({
        actor_id: session.user.id,
        action: "FILE_DOWNLOAD",
        target_type: "file",
        target_id: fileId,
        ip: extractIp(reqHeaders),
        user_agent: extractUserAgent(reqHeaders),
        result: "failure:s3_not_configured",
        metadata: { fileType, fileName },
      });

      return NextResponse.json(
        {
          error: "Storage not configured",
          message:
            "S3/MinIO storage is not configured. Set S3_ENDPOINT, S3_BUCKET, " +
            "S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY environment variables.",
        },
        { status: 501 },
      );
    }

    // ── Mint presigned URL ───────────────────────────────────────────
    const tenantId = (user.tenantId as string) ?? "";

    const result = await getPresignedDownloadUrl({
      tenantId,
      fileType: fileType as FileType,
      fileId,
      objectKey,
      ttlSeconds: PRESIGNED_URL_TTL_SECONDS,
    });

    if (!result) {
      return NextResponse.json(
        { error: "Failed to generate download URL" },
        { status: 500 },
      );
    }

    // ── Audit log ────────────────────────────────────────────────────
    const reqHeaders = await headers();
    await writeAuditLog({
      actor_id: session.user.id,
      action: "FILE_DOWNLOAD",
      target_type: "file",
      target_id: fileId,
      ip: extractIp(reqHeaders),
      user_agent: extractUserAgent(reqHeaders),
      result: "success",
      metadata: {
        fileType,
        fileName,
        expiresIn: PRESIGNED_URL_TTL_SECONDS,
      },
    });

    return NextResponse.json({
      url: result.url,
      expiresIn: result.expiresIn,
    });
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };

    if (err.status) {
      return NextResponse.json(
        { error: err.error ?? err.message },
        { status: err.status },
      );
    }

    console.error("[downloads] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
