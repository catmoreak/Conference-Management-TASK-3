import type { Role, ScopeType, ServiceId } from "./types.js";

/**
 * The permission catalogue. This is the ONLY place permission strings are
 * declared. Handlers, middleware, and WS guards must reference these named
 * constants (or the Permission union), never a role name, and never a raw
 * string literal typed by hand at the call site.
 */
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
 * list. Omitting a scope kind here is how a cascade is *prevented*: e.g.
 * 'playback:control' only lists 'session', so an event_admin's event-scoped
 * grant can never satisfy it, no matter what fields a resource carries.
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

/** Permissions denied once the target submission's status is 'approved', for every actor except a global-scope (system_admin) grant. */
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
    "submission:create",
    "submission:read",
    "submission:update",
    "submission:delete",
    "submission:download",
  ],
  reviewer: ["event:read", "session:read", "submission:read", "submission:download", "submission:approve", "submission:reject"],
  operator: ["session:read", "playback:control", "playback:read"],
  event_admin: [
    "event:read",
    "event:update",
    "session:create",
    "session:update",
    "session:read",
    "staff:assign",
    "staff:read",
    "presenter:checkin",
    "presenter:read",
    "submission:read",
    "submission:download",
  ],
  system_admin: PERMISSIONS.filter(
    (p) => p !== "submission:read_raw" && p !== "submission:write_derived" && p !== "submission:read_approved",
  ),
};

/** Roles event_admin's staff:assign may target. Enforced in authorize.ts, not just by scope. */
export const ASSIGNABLE_BY_EVENT_ADMIN: ReadonlySet<Role> = new Set(["reception_staff", "reviewer", "operator"]);

/** Static, code-only permission sets for non-human service principals. */
export const SERVICE_PERMISSIONS: Record<ServiceId, readonly Permission[]> = {
  "conversion-worker": ["submission:read_raw", "submission:write_derived"],
  "malware-scanner": ["submission:read_raw"],
  "podium-app": ["submission:read_approved"],
};

/** Service permissions that additionally require a live human co-authorization, and what kind. */
export const SERVICE_CO_AUTH: Partial<Record<Permission, "operator_session">> = {
  "submission:read_approved": "operator_session",
};
