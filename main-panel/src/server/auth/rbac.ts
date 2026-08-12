/**
 * RBAC (Role-Based Access Control) — central permission map.
 *
 * Roles (exactly 3 — no other role values are permitted):
 *   - admin: full access to everything, including account/user management
 *     and full file management (view/upload/delete/rename/reorder, sees
 *     who uploaded each file).
 *   - reviewer: can add (upload) presentation files, delete files, and
 *     reorder them; also reviews/approves-or-rejects presenter-submitted
 *     material from the check-in kiosk. Cannot manage accounts or rename
 *     files.
 *   - presenter: can reorder the file list and present (drive the podium
 *     display) plus view/download files, but cannot upload, delete, or
 *     rename them.
 */

/** All permission keys used across the application. */
export type Permission =
  // Account / user management
  | "account:create"
  | "account:suspend"
  | "account:unsuspend"
  | "account:change-role"
  | "account:list"
  | "account:mfa-reset"
  | "session:revoke"
  // Materials
  | "material:view"
  | "material:download"
  | "material:upload"
  | "material:delete"
  | "material:rename"
  | "material:reorder"
  | "material:review"
  // Events
  | "event:view"
  | "event:create"
  | "event:edit"
  | "event:delete"
  // Rooms (sub-resource of Event)
  | "room:view"
  | "room:manage"
  // Presenters (sub-resource of Event; no PII per FR-EVT-003)
  | "presenter:view"
  | "presenter:manage"
  // Assignments (presenter ↔ session join)
  | "assignment:manage"
  // Live control
  | "live-control:operate"
  | "live-control:view"
  // General
  | "dashboard:view";

export type AppRole = "admin" | "reviewer" | "presenter";

/** Permissions granted to each role. */
const ROLE_PERMISSIONS: Record<AppRole, ReadonlySet<Permission>> = {
  admin: new Set<Permission>([
    // Account management
    "account:create",
    "account:suspend",
    "account:unsuspend",
    "account:change-role",
    "account:list",
    "account:mfa-reset",
    "session:revoke",
    // Materials — full control, including rename (the other two roles
    // cannot rename files)
    "material:view",
    "material:download",
    "material:upload",
    "material:delete",
    "material:rename",
    "material:reorder",
    "material:review",
    // Events
    "event:view",
    "event:create",
    "event:edit",
    "event:delete",
    // Rooms
    "room:view",
    "room:manage",
    // Presenters
    "presenter:view",
    "presenter:manage",
    // Assignments
    "assignment:manage",
    // Live control
    "live-control:operate",
    "live-control:view",
    // General
    "dashboard:view",
  ]),

  reviewer: new Set<Permission>([
    // Materials — add, delete, reorder (no rename, no account management)
    "material:view",
    "material:download",
    "material:upload",
    "material:delete",
    "material:reorder",
    "material:review",
    // Events
    "event:view",
    "event:create",
    "event:edit",
    "event:delete",
    // Rooms
    "room:view",
    "room:manage",
    // Presenters
    "presenter:view",
    "presenter:manage",
    // Assignments
    "assignment:manage",
    // Live control
    "live-control:operate",
    "live-control:view",
    // General
    "dashboard:view",
  ]),

  presenter: new Set<Permission>([
    // Materials — view/download and reorder only, no upload/delete/rename
    "material:view",
    "material:download",
    "material:reorder",
    // Events, Rooms and Presenters — read-only (needed to pick what to present)
    "event:view",
    "room:view",
    "presenter:view",
    // Live control — drives the actual podium presentation
    "live-control:operate",
    "live-control:view",
    // General
    "dashboard:view",
  ]),
};

/**
 * Check whether a role has ALL of the specified permissions.
 */
export function roleHasPermissions(
  role: string,
  ...permissions: Permission[]
): boolean {
  const rolePerms = ROLE_PERMISSIONS[role as AppRole];
  if (!rolePerms) return false;
  return permissions.every((p) => rolePerms.has(p));
}

/**
 * Assert that a session's user role has the required permissions.
 * Throws an object with `status` and `error` if not authorized.
 */
export function assertPermissions(
  userRole: string | undefined | null,
  ...permissions: Permission[]
): void {
  if (!userRole) {
    throw { status: 403, error: "No role assigned" };
  }
  if (!roleHasPermissions(userRole, ...permissions)) {
    throw {
      status: 403,
      error: `Role '${userRole}' lacks required permissions: ${permissions.join(", ")}`,
    };
  }
}

/**
 * Assert that the user's role is one of the allowed roles.
 */
export function assertRole(
  userRole: string | undefined | null,
  ...allowedRoles: AppRole[]
): void {
  if (!userRole || !allowedRoles.includes(userRole as AppRole)) {
    throw {
      status: 403,
      error: `Role '${userRole ?? "none"}' is not in allowed roles: ${allowedRoles.join(", ")}`,
    };
  }
}
