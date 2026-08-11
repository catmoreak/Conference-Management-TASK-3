import { NextResponse } from "next/server";

import { db } from "~/server/db";
import { getSession } from "~/server/better-auth/server";
import { assertPermissions } from "~/server/auth/rbac";
import { assertTenantAccess } from "~/server/auth/tenant";
import { getPresignedDownloadUrl, isS3Configured } from "~/server/storage/s3-client";
import { PRESIGNED_URL_TTL_SECONDS } from "~/server/auth/authz/presign-policy";

/**
 * GET /api/submissions/[id]/playback-url
 *
 * Mints a short-lived presigned URL for an approved submission's file, for
 * an operator to hand to podium for live playback. Deliberately separate
 * from /api/downloads: that route blocks pres_ops_staff from "original"
 * files (a "download a copy to your computer" restriction), which would
 * otherwise be an unrelated obstacle to this route's actual purpose --
 * operating a live session is a distinct capability from downloading
 * originals, gated here by "live-control:operate" instead of
 * "material:download".
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = session.user as Record<string, unknown>;
    assertPermissions(user.role as string | undefined, "live-control:operate");

    const { id } = await params;
    const submission = await db.submission.findUnique({
      where: { id },
      include: { event: true },
    });

    if (!submission || submission.deletedAt) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }
    assertTenantAccess(session, submission.event.tenantId, true);

    if (submission.status !== "approved") {
      return NextResponse.json({ error: "Submission is not approved for live playback" }, { status: 403 });
    }
    if (!submission.objectKey) {
      return NextResponse.json({ error: "Submission has no stored file" }, { status: 404 });
    }

    if (!isS3Configured()) {
      return NextResponse.json({ error: "Storage not configured" }, { status: 501 });
    }

    const result = await getPresignedDownloadUrl({
      tenantId: submission.event.tenantId,
      fileType: "original",
      fileId: submission.id,
      objectKey: submission.objectKey,
      ttlSeconds: PRESIGNED_URL_TTL_SECONDS,
    });

    if (!result) {
      return NextResponse.json({ error: "Failed to generate playback URL" }, { status: 500 });
    }

    return NextResponse.json({ url: result.url, expiresIn: result.expiresIn });
  } catch (error: unknown) {
    const err = error as { status?: number; error?: string; message?: string };
    if (err.status) {
      return NextResponse.json({ error: err.error ?? err.message }, { status: err.status });
    }
    console.error("[submissions/playback-url] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
