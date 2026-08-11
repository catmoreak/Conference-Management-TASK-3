-- Migration: add_submission_review_note
-- Adds a reviewer-supplied reason for rejecting a submission, so the
-- presenter (or staff re-reviewing later) knows what to fix.

ALTER TABLE "submissions"
    ADD COLUMN "review_note" TEXT;
