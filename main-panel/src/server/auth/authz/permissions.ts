/**
 * Ported from server/src/auth/permissions.ts, unchanged except where noted.
 * This is the ONLY place permission strings are declared for the
 * reconciled model. Not wired to any route yet.
 */

import type { Role, ScopeType, ServiceId } from "./types";

export const PERMISSIONS = [
  "event:create",
  "event:read",
  "event:update",
  "session:create",
  "session:update",
  "session:read",
  "staff:assign",
  "staff:read",
  "presenter:checkin",
  "presenter:read",
  // New presenter write permissions (FR-EVT-003: no PII fields enforced at
  // the model layer, not the permission layer)
  "presenter:create",
  "presenter:update",
  "presenter:delete",
  // Room management (sub-resource of Event)
  "room:create",
  "room:read",
  "room:update",
  "room:delete",
  // Presentation assignment management
  "assignment:create",
  "assignment:update",
  "assignment:delete",
  "submission:create",
  "submission:read",
  "submission:update",
  "submission:delete",
  "submission:download",
  "submission:approve",
  "submission:reject",
  "playback:control",
  "playback:read",
  "audit:read",
  // Service-principal-only. Never granted to a human role (see
  // ROLE_PERMISSIONS below) and never resolvable to system_admin.
  "submission:read_raw",
  "submission:write_derived",
  "submission:read_approved",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isKnownPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * Which scope_type(s) satisfy each permission, independent of role. A
 * 'global' assignment always satisfies any permission regardless of this
 * list (subject to the tenant precondition in authorize.ts). "session"
 * here refers to LiveSession (see types.ts) -- the string value itself is
 * unchanged from server/'s original to avoid touching every scope-matching
 * call site over a naming preference.
 */
export const PERMISSION_ALLOWED_SCOPES: Record<Permission, readonly ScopeType[]> = {
  "event:create": [],
  "event:read": ["event"],
  "event:update": ["event"],
  "session:create": ["event"],
  "session:update": ["event"],
  "session:read": ["event", "session"],
  "staff:assign": ["event"],
  "staff:read": ["event"],
  "presenter:checkin": ["event"],
  "presenter:read": ["event"],
  "presenter:create": ["event"],
  "presenter:update": ["event"],
  "presenter:delete": ["event"],
  "room:create": ["event"],
  "room:read": ["event"],
  "room:update": ["event"],
  "room:delete": ["event"],
  "assignment:create": ["event"],
  "assignment:update": ["event"],
  "assignment:delete": ["event"],
  "submission:create": ["own", "event"],
  "submission:read": ["own", "event"],
  "submission:update": ["own", "event"],
  "submission:delete": ["own", "event"],
  "submission:download": ["own", "event"],
  "submission:approve": ["event"],
  "submission:reject": ["event"],
  "playback:control": ["session"],
  "playback:read": ["session"],
  "audit:read": [],
  "submission:read_raw": [],
  "submission:write_derived": [],
  "submission:read_approved": [],
};

/** Permissions denied once the target submission's status is 'approved', for every actor except a global-scope grant. */
export const STATE_GUARDED_PERMISSIONS: ReadonlySet<Permission> = new Set([
  "submission:update",
  "submission:delete",
]);

/** Role -> permission map. This is the ONLY place role/permission pairing is decided. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  presenter: ["submission:create", "submission:read", "submission:update", "submission:delete", "submission:download"],
  reception_staff: [
    "event:read",
    "session:read",
    "presenter:checkin",
    "presenter:read",
    "presenter:create",
    "presenter:update",
    "room:read",
    "assignment:create",
    "assignment:update",
    "submission:create",
    "submission:read",
    "submission:update",
    "submission:delete",
    "submission:download",
  ],
  reviewer: ["event:read", "session:read", "room:read", "presenter:read", "submission:read", "submission:download", "submission:approve", "submission:reject"],
  // audit:read added to operator/event_admin (2026-08 reconciliation): the
  // old model's dashboard:view was granted to staff/pres_ops_staff too, and
  // the pilot (audit/route.ts) confirmed neither new role had an equivalent
  // -- no comment/ADR/test anywhere signals this was deliberate exclusion
  // (unlike playback:control, which IS explicitly documented as excluded
  // from event_admin -- see the PERMISSION_ALLOWED_SCOPES comment above).
  operator: [
    "session:read",
    "room:read",
    "presenter:read",
    "playback:control",
    "playback:read",
    "audit:read",
    "submission:read",
    "submission:download",
  ],
  event_admin: [
    "event:read",
    "event:update",
    // event:create widened in (2026-08 reconciliation): no comment/ADR
    // signals deliberate exclusion (unlike playback:control, which IS
    // explicitly documented as excluded) -- reads as an original-catalogue
    // gap, since a tenant-wide event_admin grant (the shape backfill
    // produces) has no parent event to scope event:create against anyway,
    // and nobody had reason to add the string until that grant shape existed.
    "event:create",
    "session:create",
    "session:update",
    "session:read",
    "staff:assign",
    "staff:read",
    "presenter:checkin",
    "presenter:read",
    "presenter:create",
    "presenter:update",
    "presenter:delete",
    "room:create",
    "room:read",
    "room:update",
    "room:delete",
    "assignment:create",
    "assignment:update",
    "assignment:delete",
    "submission:read",
    "submission:download",
    "audit:read",
  ],
  system_admin: PERMISSIONS.filter(
    (p) => p !== "submission:read_raw" && p !== "submission:write_derived" && p !== "submission:read_approved",
  ),
};

/** Roles event_admin's staff:assign may target. Enforced in authorize.ts, not just by scope. */
export const ASSIGNABLE_BY_EVENT_ADMIN: ReadonlySet<Role> = new Set(["reception_staff", "reviewer", "operator"]);

/** Static, code-only permission sets for non-human service principals. Deliberately NOT rows in user_role_assignments -- see the migration comment on the `roles` table. */
export const SERVICE_PERMISSIONS: Record<ServiceId, readonly Permission[]> = {
  "conversion-worker": ["submission:read_raw", "submission:write_derived"],
  "malware-scanner": ["submission:read_raw"],
  "podium-app": ["submission:read_approved"],
};

/** Service permissions that additionally require a live human co-authorization, and what kind. */
export const SERVICE_CO_AUTH: Partial<Record<Permission, "operator_session">> = {
  "submission:read_approved": "operator_session",
};
