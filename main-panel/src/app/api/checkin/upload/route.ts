import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { db } from "~/server/db";
import { writeAuditLog, extractIp, extractUserAgent } from "~/server/auth/audit";
import { getPublicObjectUrl, isS3Configured, uploadObjectToS3 } from "~/server/storage/s3-client";
import { MAX_UPLOAD_BYTES, detectFileKind, isExtensionConsistent } from "~/server/storage/file-validation";

/**
 * Public check-in upload endpoint — no authentication required.
 *
 * Scoped instead by data validity: the caller must supply a real
 * presenterId belonging to a published event. This is what the no-login
 * kiosk (src/app/checkin/page.tsx) calls -- /api/uploads requires a Better
 * Auth session, which an anonymous kiosk visitor never has.
 */

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^\w.\-]/g, "_");
}

export async function POST(request: Request) {
  try {
    if (!isS3Configured()) {
      return NextResponse.json(
        {
          error: "Storage not configured",
          message: "Set S3_ENDPOINT and S3_BUCKET on the server.",
        },
        { status: 501 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const presenterId = formData.get("presenterId");

    if (typeof presenterId !== "string" || !presenterId) {
      return NextResponse.json({ error: "presenterId is required" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "file is empty" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `file too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB)` },
        { status: 413 },
      );
    }

    const presenter = await db.presenter.findUnique({
      where: { id: presenterId },
      include: {
        event: true,
        presentationAssignments: {
          select: { liveSessionId: true },
          orderBy: { sortOrder: "asc" },
          take: 1,
        },
      },
    });

    if (!presenter) {
      return NextResponse.json({ error: "Presenter not found" }, { status: 404 });
    }
    if (presenter.event.status !== "published") {
      return NextResponse.json({ error: "This event is not open for check-in" }, { status: 403 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const kind = detectFileKind(fileBuffer);
    // Only block when we *positively* identify a mismatch (e.g. PDF bytes
    // claiming a .pptx extension). Files whose type cannot be detected
    // (kind === "unknown") are allowed through -- encrypted/password-protected
    // PPTX files and certain cloud-tool exports use non-standard headers.
    if (kind !== "unknown" && !isExtensionConsistent(file.name, kind)) {
      return NextResponse.json(
        { error: "File content does not match a supported presentation format (.pptx, .ppt, .pdf)" },
        { status: 400 },
      );
    }

    const tenantId = presenter.event.tenantId;
    const fileId = crypto.randomUUID();
    const randomId = crypto.randomUUID();
    const objectKey = `${tenantId}/original/${fileId}/${randomId}-${sanitizeFileName(file.name)}`;

    const uploaded = await uploadObjectToS3({
      objectKey,
      body: fileBuffer,
      contentType: file.type || "application/octet-stream",
      metadata: {
        uploader_id: presenterId,
        source: "checkin-kiosk",
      },
    });

    const publicUrl = getPublicObjectUrl(uploaded.objectKey);

    const submission = await db.submission.create({
      data: {
        id: crypto.randomUUID(),
        eventId: presenter.eventId,
        liveSessionId: presenter.presentationAssignments[0]?.liveSessionId ?? null,
        presenterId: presenter.id,
        ownerId: presenter.id,
        createdBy: "checkin-kiosk",
        status: "pending",
        objectKey: uploaded.objectKey,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || "application/octet-stream",
        publicUrl,
      },
    });

    const reqHeaders = await headers();
    await writeAuditLog({
      actor_id: presenterId,
      action: "FILE_UPLOAD",
      target_type: "submission",
      target_id: submission.id,
      ip: extractIp(reqHeaders),
      user_agent: extractUserAgent(reqHeaders),
      result: "success",
      metadata: {
        objectKey: uploaded.objectKey,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || "application/octet-stream",
        eventId: presenter.eventId,
      },
    });

    return NextResponse.json({
      success: true,
      submissionId: submission.id,
      fileName: file.name,
    });
  } catch (error: unknown) {
    console.error("[checkin/upload] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
