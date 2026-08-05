/**
 * RBAC (Role-Based Access Control) — central permission map.
 *
 * Roles:
 *   - admin: full access to everything including account/user management
 *   - staff: full access except account/user management
 *   - pres_ops_staff: view/download materials + live-control operations only
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
  // Events
  | "event:view"
  | "event:create"
  | "event:edit"
  | "event:delete"
  // Live control
  | "live-control:operate"
  | "live-control:view"
  // General
  | "dashboard:view";

export type AppRole = "admin" | "staff" | "pres_ops_staff";

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
    // Materials
    "material:view",
    "material:download",
    "material:upload",
    "material:delete",
    // Events
    "event:view",
    "event:create",
    "event:edit",
    "event:delete",
    // Live control
    "live-control:operate",
    "live-control:view",
    // General
    "dashboard:view",
  ]),

  staff: new Set<Permission>([
    // Materials
    "material:view",
    "material:download",
    "material:upload",
    "material:delete",
    // Events
    "event:view",
    "event:create",
    "event:edit",
    "event:delete",
    // Live control
    "live-control:operate",
    "live-control:view",
    // General
    "dashboard:view",
  ]),

  pres_ops_staff: new Set<Permission>([
    // Materials — view and download only, no upload
    "material:view",
    "material:download",
    // Live control
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
