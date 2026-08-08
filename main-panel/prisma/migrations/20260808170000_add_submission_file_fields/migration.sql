-- Migration: add_submission_file_fields
-- Adds a presenter FK and file-metadata columns to submissions so the
-- check-in kiosk upload flow has somewhere to persist what was uploaded.

ALTER TABLE "submissions"
    ADD COLUMN "presenter_id" TEXT,
    ADD COLUMN "object_key"   TEXT,
    ADD COLUMN "file_name"    TEXT,
    ADD COLUMN "file_size"    INTEGER,
    ADD COLUMN "content_type" TEXT,
    ADD COLUMN "public_url"   TEXT;

CREATE INDEX "submissions_presenter_id_idx" ON "submissions"("presenter_id");

ALTER TABLE "submissions"
    ADD CONSTRAINT "submissions_presenter_id_fkey"
    FOREIGN KEY ("presenter_id") REFERENCES "presenters"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
