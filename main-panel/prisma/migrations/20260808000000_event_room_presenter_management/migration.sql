-- Migration: event_room_presenter_management
-- Adds Client (tenant reference table), expands Event with full scheduling
-- fields and FK to Client, adds Room, expands LiveSession with Room FK and
-- soft-delete, adds Presenter (no PII per FR-EVT-003), and adds
-- PresentationAssignment join table.

-- CreateTable: clients
CREATE TABLE "clients" (
    "id"         TEXT        NOT NULL,
    "name"       TEXT        NOT NULL,
    "slug"       TEXT        NOT NULL,
    "status"     TEXT        NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey"          PRIMARY KEY ("id"),
    CONSTRAINT "clients_status_check"  CHECK ("status" IN ('active', 'suspended'))
);

CREATE UNIQUE INDEX "clients_slug_key" ON "clients"("slug");

-- AlterTable: events -- add new feature columns and FK to clients
ALTER TABLE "events"
    ADD COLUMN "description" TEXT,
    ADD COLUMN "start_date"  TIMESTAMP(3),
    ADD COLUMN "end_date"    TIMESTAMP(3),
    ADD COLUMN "location"    TEXT,
    ADD COLUMN "status"      TEXT NOT NULL DEFAULT 'draft',
    ADD COLUMN "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "events"
    ADD CONSTRAINT "events_status_check"
    CHECK ("status" IN ('draft', 'published', 'completed', 'cancelled'));

-- NOTE: If existing event rows have tenant_id values not in clients,
-- insert placeholder client rows first before running this FK:
--   INSERT INTO "clients" ("id","name","slug","updated_at")
--     SELECT DISTINCT "tenant_id", "tenant_id", "tenant_id", NOW()
--     FROM "events"
--     WHERE "tenant_id" NOT IN (SELECT "id" FROM "clients");
ALTER TABLE "events"
    ADD CONSTRAINT "events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "clients"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: rooms
CREATE TABLE "rooms" (
    "id"         TEXT         NOT NULL,
    "event_id"   TEXT         NOT NULL,
    "name"       TEXT         NOT NULL,
    "capacity"   INTEGER,
    "location"   TEXT,
    "sort_order" INTEGER      NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rooms_event_id_idx" ON "rooms"("event_id");

-- AlterTable: live_sessions -- add room FK, status, soft-delete, sort_order
ALTER TABLE "live_sessions"
    ADD COLUMN "room_id"    TEXT,
    ADD COLUMN "status"     TEXT         NOT NULL DEFAULT 'scheduled',
    ADD COLUMN "sort_order" INTEGER      NOT NULL DEFAULT 0,
    ADD COLUMN "deleted_at" TIMESTAMP(3),
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "live_sessions"
    ADD CONSTRAINT "live_sessions_status_check"
    CHECK ("status" IN ('scheduled', 'live', 'completed', 'cancelled'));

CREATE INDEX "live_sessions_room_id_idx" ON "live_sessions"("room_id");

-- CreateTable: presenters (no PII fields -- FR-EVT-003)
CREATE TABLE "presenters" (
    "id"           TEXT         NOT NULL,
    "event_id"     TEXT         NOT NULL,
    "display_name" TEXT         NOT NULL,
    "organization" TEXT,
    "title"        TEXT,
    "notes"        TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presenters_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "presenters_event_id_idx" ON "presenters"("event_id");

-- CreateTable: presentation_assignments
CREATE TABLE "presentation_assignments" (
    "id"              TEXT         NOT NULL,
    "live_session_id" TEXT         NOT NULL,
    "presenter_id"    TEXT         NOT NULL,
    "sort_order"      INTEGER      NOT NULL DEFAULT 0,
    "duration"        INTEGER,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presentation_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "presentation_assignments_session_presenter_uniq"
        UNIQUE ("live_session_id", "presenter_id")
);

CREATE INDEX "presentation_assignments_presenter_id_idx"
    ON "presentation_assignments"("presenter_id");

-- AddForeignKey
ALTER TABLE "rooms"
    ADD CONSTRAINT "rooms_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "live_sessions"
    ADD CONSTRAINT "live_sessions_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "rooms"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "presenters"
    ADD CONSTRAINT "presenters_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "presentation_assignments"
    ADD CONSTRAINT "presentation_assignments_live_session_id_fkey"
    FOREIGN KEY ("live_session_id") REFERENCES "live_sessions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "presentation_assignments"
    ADD CONSTRAINT "presentation_assignments_presenter_id_fkey"
    FOREIGN KEY ("presenter_id") REFERENCES "presenters"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
