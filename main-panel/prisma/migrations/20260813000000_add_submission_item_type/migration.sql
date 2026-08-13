-- Migration: add_submission_item_type
-- Adds a lightweight "cover slide" item type to submissions so an admin can
-- insert a plain-text interstitial screen (e.g. the event name) anywhere in
-- a live session's file order, without uploading a real file for it.

ALTER TABLE "submissions"
    ADD COLUMN "item_type"  TEXT NOT NULL DEFAULT 'file',
    ADD COLUMN "cover_text" TEXT;

ALTER TABLE "submissions"
    ADD CONSTRAINT "submissions_item_type_check" CHECK ("item_type" IN ('file', 'cover'));
