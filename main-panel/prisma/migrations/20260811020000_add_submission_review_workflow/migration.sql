-- Migration: add_submission_review_workflow
-- Adds review metadata (who/when/checklist) and a revision counter so the
-- check-in kiosk can let a presenter replace the file on their existing
-- submission (e.g. after a rejection) instead of creating an orphaned
-- duplicate row.
--
-- Also cleans up orphaned state found on the shared dev database: columns
-- reviewer_id/return_reason/returned_at and a 'reviewed' status value, from
-- a migration (20260810150000_add_reviewed_workflow_fields) with no
-- corresponding file anywhere in this repo's git history and no
-- application code referencing them (confirmed via `git log --all` and a
-- full-repo grep before writing this). reviewed_at/review_checklist were
-- added by that same orphaned migration with types that already match what
-- this one needs (timestamp / jsonb, both nullable), so they're left in
-- place rather than dropped and re-added.
--
-- Written with IF EXISTS/IF NOT EXISTS throughout so it's safe to run
-- whether or not a given database ever had the orphaned migration applied.

ALTER TABLE "submissions"
    DROP CONSTRAINT IF EXISTS "submissions_status_check";

ALTER TABLE "submissions"
    DROP COLUMN IF EXISTS "reviewer_id",
    DROP COLUMN IF EXISTS "return_reason",
    DROP COLUMN IF EXISTS "returned_at";

ALTER TABLE "submissions"
    ADD COLUMN IF NOT EXISTS "reviewed_at"     TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "reviewed_by"      TEXT,
    ADD COLUMN IF NOT EXISTS "review_checklist" JSONB,
    ADD COLUMN IF NOT EXISTS "revision_count"   INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "submissions"
    ADD CONSTRAINT "submissions_status_check"
    CHECK ("status" IN ('pending', 'approved', 'rejected'));
