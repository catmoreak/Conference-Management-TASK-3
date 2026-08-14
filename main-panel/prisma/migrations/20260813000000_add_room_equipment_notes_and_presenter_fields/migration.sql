-- Migration: add_room_equipment_notes_and_presenter_fields
-- Adds missing fields to rooms and presenters tables matching schema.prisma

-- AlterTable: rooms
ALTER TABLE "rooms" 
    ADD COLUMN IF NOT EXISTS "equipment_notes" TEXT,
    ADD COLUMN IF NOT EXISTS "status"          TEXT NOT NULL DEFAULT 'active';

CREATE UNIQUE INDEX IF NOT EXISTS "rooms_event_id_name_uniq" ON "rooms"("event_id", "name");

-- AlterTable: presenters
ALTER TABLE "presenters"
    ADD COLUMN IF NOT EXISTS "user_id" TEXT,
    ADD COLUMN IF NOT EXISTS "name"    TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "email"   TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "bio"     TEXT,
    ADD COLUMN IF NOT EXISTS "status"  TEXT NOT NULL DEFAULT 'active';

ALTER TABLE "presenters" ALTER COLUMN "display_name" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "presenters_event_id_email_uniq" ON "presenters"("event_id", "email");
CREATE INDEX IF NOT EXISTS "presenters_user_id_idx" ON "presenters"("user_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'presenters_user_id_fkey'
    ) THEN
        ALTER TABLE "presenters"
            ADD CONSTRAINT "presenters_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
