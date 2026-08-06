-- Reconciled authorization model. Purely additive: existing "user".role /
-- "user".tenant_id columns and the Role enum are untouched. Nothing in the
-- application reads these new tables yet -- see the migration plan for the
-- cutover order.

-- CreateTable
CREATE TABLE "roles" (
    "name" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("name")
);

INSERT INTO "roles" ("name") VALUES
    ('presenter'),
    ('reception_staff'),
    ('reviewer'),
    ('operator'),
    ('event_admin'),
    ('system_admin');
-- Service principals (conversion-worker, malware-scanner, podium-app) are
-- deliberately NOT rows here or in user_role_assignments -- their
-- permission sets stay static and code-defined, so a compromised service
-- credential has no database row that could ever be escalated. See
-- server/src/auth/permissions.ts SERVICE_PERMISSIONS.

-- CreateTable
CREATE TABLE "user_role_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tenant_id" TEXT,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT,
    "granted_by" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_role_assignments_scope_type_check" CHECK ("scope_type" IN ('global', 'event', 'session', 'own')),
    -- Unchanged from server/'s original migration: global/own carry no
    -- scope_id (they don't point at one resource instance), event/session
    -- require one.
    CONSTRAINT "scope_id_matches_scope_type" CHECK (
        ("scope_type" IN ('global', 'own') AND "scope_id" IS NULL)
        OR
        ("scope_type" IN ('event', 'session') AND "scope_id" IS NOT NULL)
    )
);

-- scope_id references either events(id) or live_sessions(id) depending on
-- scope_type; Postgres has no conditional/polymorphic FK, so referential
-- integrity across that boundary is enforced at the application layer (the
-- code path that inserts assignment rows), not by the schema -- same
-- limitation and same answer as server/'s original migration.
--
-- tenant_id has no CHECK constraint: NULL (platform-wide) vs. a specific
-- tenant is a legitimate business decision made by whoever grants the row,
-- not a structural invariant the schema can validate.

CREATE INDEX "user_role_assignments_user_id_idx" ON "user_role_assignments"("user_id");
CREATE INDEX "user_role_assignments_scope_idx" ON "user_role_assignments"("scope_type", "scope_id");

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "events_tenant_id_idx" ON "events"("tenant_id");

-- CreateTable
-- Named live_sessions, not sessions -- "session" already means better-auth's
-- login session in this schema (see the existing "session" table). This is
-- server/'s conference-session concept: a specific talk/presentation slot.
CREATE TABLE "live_sessions" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "live_sessions_event_id_idx" ON "live_sessions"("event_id");

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "session_id" TEXT,
    "owner_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "submissions_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX "submissions_event_id_idx" ON "submissions"("event_id");
CREATE INDEX "submissions_session_id_idx" ON "submissions"("session_id");
CREATE INDEX "submissions_owner_id_idx" ON "submissions"("owner_id");

-- CreateTable
-- Durable log for the shadow-check harness (src/server/auth/shadow-check.ts)
-- used during the step-4 cutover window. Purely observational -- never read
-- by any authorization decision.
CREATE TABLE "authz_shadow_mismatches" (
    "id" TEXT NOT NULL,
    "check_name" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "legacy_allowed" BOOLEAN NOT NULL,
    "legacy_reason" TEXT,
    "candidate_allowed" BOOLEAN NOT NULL,
    "candidate_reason" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authz_shadow_mismatches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "authz_shadow_mismatches_check_name_idx" ON "authz_shadow_mismatches"("check_name");
CREATE INDEX "authz_shadow_mismatches_occurred_at_idx" ON "authz_shadow_mismatches"("occurred_at");

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_fkey" FOREIGN KEY ("role") REFERENCES "roles"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "live_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
