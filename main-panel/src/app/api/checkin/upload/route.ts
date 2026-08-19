import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { db } from "~/server/db";
import { writeAuditLog, extractIp, extractUserAgent } from "~/server/auth/audit";
import { isS3Configured, uploadObjectToS3 } from "~/server/storage/s3-client";
import { MAX_UPLOAD_BYTES, detectFileKind, isExtensionConsistent, checkZipBomb } from "~/server/storage/file-validation";
import { checkRateLimit } from "~/server/http/rate-limit";
import { canTransition } from "~/server/domain/submission-status";

/**
 * Public check-in upload endpoint — no authentication required.
 *
 * Scoped instead by data validity: the caller must supply a real
 * presenterId belonging to a published event. This is what the no-login
 * kiosk (src/app/checkin/page.tsx) calls -- /api/uploads requires a Better
 * Auth session, which an anonymous kiosk visitor never has.
 */

// Tighter than the GET route (main-panel/src/app/api/checkin/route.ts) --
// each request here triggers an S3 write, not just a read.
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^\w.\-]/g, "_");
}

export async function POST(request: Request) {
  try {
    const ip = extractIp(request.headers) ?? "unknown";
    const limit = checkRateLimit(`checkin-upload:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many upload attempts. Please wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

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
    const rawLiveSessionId = formData.get("liveSessionId");
    const explicitLiveSessionId =
      typeof rawLiveSessionId === "string" && rawLiveSessionId ? rawLiveSessionId : null;

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
        // Fetch all assignments so we can validate an explicit liveSessionId.
        // When no explicit session is provided, [0] is still the legacy
        // fallback (same sort order as before, just no longer capped).
        presentationAssignments: {
          select: { liveSessionId: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!presenter) {
      return NextResponse.json({ error: "Presenter not found" }, { status: 404 });
    }
    if (presenter.event.status !== "published") {
      return NextResponse.json({ error: "This event is not open for check-in" }, { status: 403 });
    }

    // Resolve which live session this upload belongs to.
    let liveSessionId: string | null;
    if (explicitLiveSessionId) {
      // Check if session belongs to the presenter's event
      const targetSession = await db.liveSession.findFirst({
        where: { id: explicitLiveSessionId, eventId: presenter.eventId, deletedAt: null },
      });
      if (!targetSession) {
        return NextResponse.json({ error: "Session not found for this event" }, { status: 400 });
      }

      if (presenter.presentationAssignments.length === 0) {
        // Presenter has no assignments yet — automatically create the assignment for this session
        await db.presentationAssignment.create({
          data: {
            id: crypto.randomUUID(),
            liveSessionId: explicitLiveSessionId,
            presenterId: presenter.id,
            sortOrder: 0,
          },
        });
      } else {
        // Validate the presenter is assigned to this specific session
        const hasAssignment = presenter.presentationAssignments.some(
          (a) => a.liveSessionId === explicitLiveSessionId,
        );
        if (!hasAssignment) {
          return NextResponse.json(
            { error: "Presenter is not assigned to this session" },
            { status: 400 },
          );
        }
      }
      liveSessionId = explicitLiveSessionId;
    } else {
      // Legacy fallback: first assignment by sort order (backward compat
      // for /checkin/page.tsx callers that don't pass liveSessionId).
      liveSessionId = presenter.presentationAssignments[0]?.liveSessionId ?? null;
    }

    // A presenter re-uploading (e.g. after a rejection) replaces the file
    // on their existing submission instead of creating an orphaned
    // duplicate row. When an explicit session is provided, scope the
    // lookup to that session so each session slot has its own independent
    // submission lifecycle. Without an explicit session, fall back to the
    // original cross-session lookup for backward compatibility.
    // "approved" is terminal in the state machine -- pres-ops may already
    // be relying on that file for a live session, so reopening it needs
    // staff, not a kiosk re-upload. Fail fast here, before the S3 write,
    // so an already-approved presenter doesn't waste an upload.
    const existingSubmission = await db.submission.findFirst({
      where: {
        presenterId: presenter.id,
        deletedAt: null,
        ...(explicitLiveSessionId ? { liveSessionId: explicitLiveSessionId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    if (existingSubmission?.status === "approved") {
      return NextResponse.json(
        {
          error:
            "This submission has already been approved. Please contact conference staff if you need to make changes.",
        },
        { status: 409 },
      );
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

    // ZIP-bomb check for PPTX/PPTM files -- this is the anonymous kiosk
    // route, the most exposed upload surface, so it gets the same
    // protection as the authenticated /api/uploads route.
    if (kind === "pptx") {
      const bombCheck = checkZipBomb(fileBuffer);
      if (!bombCheck.safe) {
        return NextResponse.json(
          { error: `File rejected: ${bombCheck.reason}` },
          { status: 400 },
        );
      }
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

    // No permanent public URL is stored here (SEC-002) -- reviewers and
    // operators fetch a short-lived presigned URL on demand instead, via
    // /api/downloads (staff dashboard "View") and
    // /api/submissions/[id]/playback-url (pres-ops "Load").
    // liveSessionId was resolved earlier (explicit or legacy fallback).
    const fileFields = {
      liveSessionId,
      objectKey: uploaded.objectKey,
      fileName: file.name,
      fileSize: file.size,
      contentType: file.type || "application/octet-stream",
    };

    let submission;
    if (existingSubmission && existingSubmission.status !== "approved") {
      // "pending" (replacing a not-yet-reviewed file) stays pending;
      // "rejected" (resubmission after feedback) moves back to pending --
      // both are legal per the state machine. Kept as a live assertion
      // (not just the earlier `?.status === "approved"` check) so this
      // still fails loudly if a future status value slips through.
      const transition = canTransition(existingSubmission.status, "pending");
      if (existingSubmission.status !== "pending" && !transition.ok) {
        return NextResponse.json({ error: transition.reason }, { status: 409 });
      }
      submission = await db.submission.update({
        where: { id: existingSubmission.id },
        data: {
          ...fileFields,
          status: "pending",
          revisionCount: { increment: 1 },
        },
      });
    } else {
      submission = await db.submission.create({
        data: {
          id: crypto.randomUUID(),
          eventId: presenter.eventId,
          presenterId: presenter.id,
          ownerId: presenter.id,
          createdBy: "checkin-kiosk",
          status: "pending",
          ...fileFields,
        },
      });
    }

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
