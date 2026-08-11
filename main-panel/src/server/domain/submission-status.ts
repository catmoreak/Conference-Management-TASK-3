/**
 * Submission status state machine.
 *
 * Single source of truth for which status transitions are legal. Replaces
 * the ad hoc `if (status !== "pending")` checks that used to live directly
 * in each mutation -- both the staff review router (approve/reject) and the
 * anonymous kiosk resubmission path (checkin/upload) go through this.
 */

export const SUBMISSION_STATUSES = ["pending", "approved", "rejected"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

function isSubmissionStatus(value: string): value is SubmissionStatus {
  return (SUBMISSION_STATUSES as readonly string[]).includes(value);
}

// "approved" is terminal by design: pres-ops may already be relying on an
// approved file for a live session, so reopening it needs a human decision
// (staff re-rejecting it explicitly isn't supported today), not an
// automatic transition from a kiosk re-upload.
const ALLOWED_TRANSITIONS: Record<SubmissionStatus, SubmissionStatus[]> = {
  pending: ["approved", "rejected"],
  approved: [],
  rejected: ["pending"], // presenter resubmission via the check-in kiosk
};

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function canTransition(from: string, to: SubmissionStatus): TransitionCheck {
  if (!isSubmissionStatus(from)) {
    return { ok: false, reason: `Unknown current status "${from}"` };
  }
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      reason: allowed.length
        ? `Cannot move from "${from}" to "${to}" (allowed: ${allowed.join(", ")})`
        : `"${from}" is a terminal status and cannot be changed`,
    };
  }
  return { ok: true };
}

// ── Review checklist ────────────────────────────────────────────────────
// A generic file-quality gate a reviewer must complete before approving.
// Rejecting doesn't require it -- a reviewer can reject for a reason the
// checklist wouldn't capture (wrong session, duplicate, etc.) without
// having opened the file.
//
// Keep REVIEW_CHECKLIST_ITEMS' keys in sync with the copy hardcoded in
// src/app/dashboard/staff/page.tsx (a "use client" component, so it can't
// import this server-side module -- see that file's comment).

export const REVIEW_CHECKLIST_ITEMS = [
  { key: "opensCorrectly", label: "File opens and renders correctly" },
  { key: "contentMatchesSession", label: "Content matches the assigned session/topic" },
  { key: "noProhibitedContent", label: "No prohibited or inappropriate content" },
  { key: "formatSupported", label: "File format is supported (.pptx, .ppt, .pdf)" },
] as const;

export type ReviewChecklistKey = (typeof REVIEW_CHECKLIST_ITEMS)[number]["key"];
export type ReviewChecklist = Record<ReviewChecklistKey, boolean>;
