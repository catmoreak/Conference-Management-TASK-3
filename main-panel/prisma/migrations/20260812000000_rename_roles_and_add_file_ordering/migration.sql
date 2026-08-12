-- Migration: rename_roles_and_add_file_ordering
-- Reduces the flat Role enum down to the 3 supported product roles
-- (admin / reviewer / presenter) and adds session-file ordering so the
-- new file manager (main-panel + podium) can persist a drag-reorderable
-- list of presentation files per live session.
--
-- RENAME VALUE (not a drop/recreate) so every existing user row keeps its
-- role -- 'staff' accounts become 'reviewer', 'pres_ops_staff' accounts
-- become 'presenter', with zero data loss or manual backfill required.
ALTER TYPE "Role" RENAME VALUE 'staff' TO 'reviewer';
ALTER TYPE "Role" RENAME VALUE 'pres_ops_staff' TO 'presenter';

ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'reviewer';

ALTER TABLE "submissions"
    ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
