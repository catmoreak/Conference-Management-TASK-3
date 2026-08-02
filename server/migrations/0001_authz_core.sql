-- Authorization core: roles, permissions, scoped role assignments, audit log,
-- plus the minimal event/session/submission reference tables the authz layer
-- resolves resources against. This migration intentionally does not model
-- the full submission/conversion/review feature set (uploads, file versions,
-- conversion jobs, etc.) -- those belong to feature-endpoint migrations that
-- come later. Only the columns authz decisions actually read are included
-- here: owner_id / created_by (ownership + provenance), event_id / session_id
-- (scope matching), status (state guard on submission:update / :delete).

begin;

-- ---------------------------------------------------------------------------
-- Reference: valid human roles. Service principals (conversion-worker,
-- malware-scanner, podium-app) are deliberately NOT rows in this table or in
-- user_role_assignments -- their permission sets are static and defined in
-- code (src/auth/permissions.ts), so a compromised service credential has no
-- database row that could ever be escalated to system_admin.
-- ---------------------------------------------------------------------------
create table roles (
  name text primary key
);

insert into roles (name) values
  ('presenter'),
  ('reception_staff'),
  ('reviewer'),
  ('operator'),
  ('event_admin'),
  ('system_admin');

-- ---------------------------------------------------------------------------
-- Reference: the permission catalogue. This table exists for documentation
-- and for any tooling that wants to enumerate valid permissions; it is NOT
-- authoritative for authorization decisions (src/auth/permissions.ts's
-- typed const union is) and audit_log.permission deliberately has no FK to
-- this table -- an attempt to use an unknown permission string must still
-- produce a deny audit row, which an FK constraint would make impossible.
-- ---------------------------------------------------------------------------
create table permissions (
  name text primary key
);

insert into permissions (name) values
  ('event:create'),
  ('event:read'),
  ('event:update'),
  ('session:create'),
  ('session:update'),
  ('session:read'),
  ('staff:assign'),
  ('staff:read'),
  ('presenter:checkin'),
  ('presenter:read'),
  ('submission:create'),
  ('submission:read'),
  ('submission:update'),
  ('submission:delete'),
  ('submission:download'),
  ('submission:approve'),
  ('submission:reject'),
  ('playback:control'),
  ('playback:read'),
  ('audit:read');
  -- submission:read_raw, submission:write_derived, submission:read_approved
  -- are service-principal-only and intentionally excluded from this table:
  -- they are never grantable to a human role, so they never appear in
  -- user_role_assignments and don't need a reference row here.

-- ---------------------------------------------------------------------------
-- The single source of truth for "who can act as what, where."
-- scope_type has four kinds:
--   global  - matches any resource (system_admin)
--   event   - matches resource.event_id = scope_id (event_admin, and
--             event-scoped grants for reception_staff/reviewer)
--   session - matches resource.session_id = scope_id (operator, including a
--             presenter's time-boxed self-playback grant -- see expires_at)
--   own     - matches resource.owner_id = user_id, ignoring scope_id
--             (presenter; avoids treating their grant as a blanket global
--             allow while still not hardcoding the role name in the matcher)
-- expires_at supports time-boxed grants, e.g. a presenter given a session-
-- scoped 'operator' row for the duration of their own talk.
-- ---------------------------------------------------------------------------
create table user_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  role text not null references roles(name),
  scope_type text not null check (scope_type in ('global', 'event', 'session', 'own')),
  scope_id uuid,
  granted_by text not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  constraint scope_id_matches_scope_type check (
    (scope_type in ('global', 'own') and scope_id is null)
    or
    (scope_type in ('event', 'session') and scope_id is not null)
  )
);

-- scope_id references either events(id) or sessions(id) depending on
-- scope_type; Postgres has no conditional/polymorphic FK, so referential
-- integrity across that boundary is enforced at the application layer
-- (the code path that inserts assignment rows), not by the schema.

create index user_role_assignments_user_id_idx on user_role_assignments (user_id) where revoked_at is null;
create index user_role_assignments_scope_idx on user_role_assignments (scope_type, scope_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Minimal reference tables so resource resolvers and tests have something
-- real to resolve against. Full event/session/submission feature schemas
-- (titles, scheduling, file versions, conversion status, etc.) are out of
-- scope for this migration.
-- ---------------------------------------------------------------------------
create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id),
  name text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create index sessions_event_id_idx on sessions (event_id);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id),
  session_id uuid references sessions(id),
  owner_id text not null,
  created_by text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index submissions_event_id_idx on submissions (event_id);
create index submissions_session_id_idx on submissions (session_id);
create index submissions_owner_id_idx on submissions (owner_id);

-- ---------------------------------------------------------------------------
-- Every authorization decision -- allow or deny -- produces a row here.
-- permission and resource_type/resource_id are plain text, not FKs: a
-- request for an unknown permission string, or against a resource that
-- doesn't exist, must still be auditable as a denial.
-- ---------------------------------------------------------------------------
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('user', 'service')),
  actor_id text not null,
  permission text not null,
  resource_type text,
  resource_id text,
  decision text not null check (decision in ('allow', 'deny')),
  reason text not null,
  occurred_at timestamptz not null default now()
);

create index audit_log_occurred_at_idx on audit_log (occurred_at);
create index audit_log_actor_idx on audit_log (actor_type, actor_id);

commit;
