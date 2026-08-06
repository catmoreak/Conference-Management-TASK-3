/**
 * Ported from server/src/auth/authorize.ts. Not wired to any route yet.
 *
 * authorizeMutationAndRun (the transactional audit wrapper) is deliberately
 * NOT ported here -- it depends on AuthzAuditLog, which belongs to the
 * audit-migration step. This file covers the read-path decision only:
 * canUserPerform and what it depends on.
 */

import { PERMISSION_ALLOWED_SCOPES, ROLE_PERMISSIONS, SERVICE_CO_AUTH, SERVICE_PERMISSIONS, STATE_GUARDED_PERMISSIONS, ASSIGNABLE_BY_EVENT_ADMIN, isKnownPermission } from "./permissions";
import type { Actor, AuditLogEntry, AuthzDecision, AuthzResource, AuthzStore, AuthzTransaction, HumanActor, Permission, Role, RoleAssignment, ScopeType, ServiceActor } from "./types";

function actorId(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.serviceId;
}

function buildAuditEntry(actor: Actor, permission: string, resource: AuthzResource | null, decision: AuthzDecision): AuditLogEntry {
  return {
    actorType: actor.kind,
    actorId: actorId(actor),
    permission,
    resourceType: resource?.type ?? null,
    resourceId: resource?.id ?? null,
    decision: decision.allow ? "allow" : "deny",
    reason: decision.reason,
  };
}

/** Writes an audit row without letting a failure there affect the caller. Same convention as writeAuditLog. */
export async function recordAuditBestEffort(store: AuthzStore, entry: AuditLogEntry): Promise<void> {
  try {
    await store.recordAuditLog(entry);
  } catch {
    // Deliberately swallowed -- an audit-log outage must not take down
    // authorization decisions for reads or break denials.
  }
}

/**
 * Tenant precondition, applied uniformly ahead of the scope_type matching
 * below -- this is the one genuinely new axis this reconciliation adds.
 *
 *   - assignment.tenantId === null  => platform-wide grant, always passes
 *     (mirrors tenant.ts's existing allowAdminCrossTenant escape hatch).
 *   - resource === null             => nothing to compare yet (e.g. a
 *     create, the resource doesn't exist). The create handler itself is
 *     responsible for stamping the new row with the actor's own tenant --
 *     scopeMatches can't verify a tenant that doesn't exist yet.
 *   - resource.tenantId === undefined => FAIL CLOSED. A tenant-scoped grant
 *     must never be treated as matching a resource whose tenant simply
 *     wasn't resolved -- that would be a silent fail-open on tenant
 *     isolation from a resolver bug, not a legitimate case. Every resolver
 *     in resolvers.ts always populates tenantId for a real resource.
 */
function tenantMatches(assignment: RoleAssignment, resource: AuthzResource | null): boolean {
  if (assignment.tenantId === null) return true;
  if (resource === null) return true;
  if (resource.tenantId === undefined) return false;
  return resource.tenantId === assignment.tenantId;
}

function scopeMatches(
  assignment: RoleAssignment,
  allowedScopes: readonly ScopeType[],
  resource: AuthzResource | null,
  actor: HumanActor,
): boolean {
  if (assignment.scopeType === "global") {
    // A tenant-scoped global grant (e.g. a tenant admin) is still bounded
    // by tenant once a resource exists to check against; with no resource
    // yet (a create), there's nothing to bound it against.
    if (assignment.tenantId !== null && resource !== null && !tenantMatches(assignment, resource)) return false;
    return true;
  }
  if (!resource) return false;
  if (!tenantMatches(assignment, resource)) return false;
  if (!allowedScopes.includes(assignment.scopeType)) return false;
  switch (assignment.scopeType) {
    case "event":
      return resource.eventId !== undefined && resource.eventId === assignment.scopeId;
    case "session":
      return resource.sessionId !== undefined && resource.sessionId === assignment.scopeId;
    case "own":
      // scopeId is deliberately never read here: an 'own' assignment's
      // authority comes entirely from resource.ownerId === actor.userId.
      return resource.ownerId !== undefined && resource.ownerId === actor.userId;
    default:
      return false;
  }
}

async function resolveHuman(
  actor: HumanActor,
  permission: Permission,
  resource: AuthzResource | null,
  store: AuthzStore,
): Promise<AuthzDecision> {
  const assignments = await store.getActiveAssignments(actor.userId);
  const grantingAssignments = assignments.filter((a) => ROLE_PERMISSIONS[a.role].includes(permission));
  if (grantingAssignments.length === 0) {
    return { allow: false, reason: "no_role_grant" };
  }

  const allowedScopes = PERMISSION_ALLOWED_SCOPES[permission];
  const matching = grantingAssignments.filter((a) => scopeMatches(a, allowedScopes, resource, actor));
  if (matching.length === 0) {
    // Distinguish "wrong tenant entirely" from "right tenant, wrong
    // event/session/own scope" -- tenant is the new, security-critical
    // dimension this reconciliation adds, worth a distinct audit reason.
    const anyTenantMatch = grantingAssignments.some((a) => tenantMatches(a, resource));
    return { allow: false, reason: anyTenantMatch ? "scope_mismatch" : "tenant_mismatch" };
  }

  const isGlobalGrant = matching.some((a) => a.scopeType === "global");

  if (permission === "staff:assign" && !isGlobalGrant) {
    if (!resource?.targetRole || !ASSIGNABLE_BY_EVENT_ADMIN.has(resource.targetRole)) {
      return { allow: false, reason: "staff_assign_target_role_forbidden" };
    }
  }

  if (STATE_GUARDED_PERMISSIONS.has(permission) && !isGlobalGrant && resource?.status === "approved") {
    return { allow: false, reason: "state_guard_approved" };
  }

  return { allow: true, reason: "granted" };
}

async function resolveService(
  actor: ServiceActor,
  permission: Permission,
  resource: AuthzResource | null,
  store: AuthzStore,
): Promise<AuthzDecision> {
  if (!SERVICE_PERMISSIONS[actor.serviceId].includes(permission)) {
    return { allow: false, reason: "service_permission_not_granted" };
  }

  const coAuth = SERVICE_CO_AUTH[permission];
  if (!coAuth) {
    return { allow: true, reason: "granted" };
  }

  if (coAuth === "operator_session") {
    if (!actor.onBehalfOfSessionId || !resource || resource.sessionId !== actor.onBehalfOfSessionId) {
      return { allow: false, reason: "service_session_mismatch" };
    }
    const hasOperator = await store.hasActiveOperatorForLiveSession(actor.onBehalfOfSessionId);
    if (!hasOperator) {
      return { allow: false, reason: "no_active_operator_for_session" };
    }
    return { allow: true, reason: "granted" };
  }

  return { allow: false, reason: "unhandled_co_auth" };
}

/** Pure decision resolution -- no audit side effect. */
async function evaluatePermission(actor: Actor, permission: string, resource: AuthzResource | null, store: AuthzStore): Promise<AuthzDecision> {
  if (!isKnownPermission(permission)) {
    return { allow: false, reason: "unknown_permission" };
  }
  return actor.kind === "service" ? resolveService(actor, permission, resource, store) : resolveHuman(actor, permission, resource, store);
}

/**
 * The single reusable authorization check: resolves the role/service grant
 * and the scope+tenant match in one call, and always records an audit row.
 * A failure to record it never changes the returned decision (see
 * recordAuditBestEffort).
 */
export async function canUserPerform(actor: Actor, permission: string, resource: AuthzResource | null, store: AuthzStore): Promise<AuthzDecision> {
  const decision = await evaluatePermission(actor, permission, resource, store);
  await recordAuditBestEffort(store, buildAuditEntry(actor, permission, resource, decision));
  return decision;
}

/**
 * A real Error instance (instanceof checks, stack trace) that ALSO carries
 * the `{ status, error }` shape rbac.ts's assertRole/assertPermissions
 * already throw. Existing route handlers pattern-match on that shape
 * (`const err = error as { status?: number; error?: string; ... }; if
 * (err.status) {...}`) -- an Error subclass without these two properties
 * would silently fall through to their unexpected-500 branch instead of a
 * proper 403, exactly the bug shadow-check.ts's re-throw-the-original-error
 * design exists to avoid on the legacy side. Matching the shape here means
 * step 4's cutover doesn't also require touching every catch block.
 */
export class AuthzDeniedError extends Error {
  readonly status = 403;
  readonly error: string;

  constructor(public readonly reason: string) {
    super(`authorization denied: ${reason}`);
    this.name = "AuthzDeniedError";
    this.error = `authorization denied: ${reason}`;
  }
}

/**
 * Check-then-act helper for gated side effects that are NOT database
 * mutations needing transactional audit atomicity.
 */
export async function authorizeAndRun<T>(actor: Actor, permission: Permission, resource: AuthzResource | null, store: AuthzStore, action: () => Promise<T>): Promise<T> {
  const decision = await canUserPerform(actor, permission, resource, store);
  if (!decision.allow) {
    throw new AuthzDeniedError(decision.reason);
  }
  return action();
}

/**
 * Check-then-act helper for database mutations. Unlike authorizeAndRun, the
 * allow-decision audit row and the mutation are written in ONE transaction:
 * if `mutate` throws, the transaction rolls back and the audit row is never
 * persisted either -- never a committed mutation with no audit trail, never
 * a committed "allow" audit row for a mutation that didn't happen. Denials
 * are still best-effort/non-transactional (see recordAuditBestEffort) --
 * there is nothing to keep them atomic with, since nothing else happens on
 * the deny path.
 */
export async function authorizeMutationAndRun<T>(
  actor: Actor,
  permission: Permission,
  resource: AuthzResource | null,
  store: AuthzStore,
  mutate: (tx: AuthzTransaction) => Promise<T>,
): Promise<T> {
  const decision = await evaluatePermission(actor, permission, resource, store);
  if (!decision.allow) {
    await recordAuditBestEffort(store, buildAuditEntry(actor, permission, resource, decision));
    throw new AuthzDeniedError(decision.reason);
  }
  return store.runInTransaction(async (tx) => {
    await tx.recordAuditLog(buildAuditEntry(actor, permission, resource, decision));
    return mutate(tx);
  });
}

/**
 * Role-identity checks -- deliberately separate from canUserPerform, which
 * is permission-based by design. These exist for exactly one reason: the
 * new catalogue has NO permission string for account/login-session
 * administration at all (no account:create/suspend/.../session:revoke
 * equivalent anywhere -- confirmed by inspection, not assumed), so the 5
 * admin-only account/session-management routes and the one inline
 * admin/staff/pres_ops_staff gate have nothing to check via the normal
 * permission path. This is a minimal, explicitly-scoped stopgap for that
 * specific gap -- not a pattern to reach for where a real permission
 * exists; canUserPerform/authorizeAndRun remain the default everywhere else.
 */

/** Does actor hold an active assignment with exactly this role (any scope)? */
export async function hasRoleGrant(actor: Actor, role: Role, store: AuthzStore): Promise<AuthzDecision> {
  if (actor.kind !== "user") {
    return { allow: false, reason: "service_actor_not_applicable" };
  }
  const assignments = await store.getActiveAssignments(actor.userId);
  return assignments.some((a) => a.role === role) ? { allow: true, reason: "granted" } : { allow: false, reason: "no_role_grant" };
}

/** Throwing variant of hasRoleGrant, matching authorizeAndRun's shape for use as a shadowCompare candidate. */
export async function requireRoleGrant(actor: Actor, role: Role, store: AuthzStore): Promise<void> {
  const decision = await hasRoleGrant(actor, role, store);
  await recordAuditBestEffort(store, buildAuditEntry(actor, `role:${role}`, null, decision));
  if (!decision.allow) {
    throw new AuthzDeniedError(decision.reason);
  }
}

/** Does actor hold ANY active role assignment at all, regardless of which role? Mirrors a broad "is this a recognized, provisioned user" gate. */
export async function hasAnyRoleGrant(actor: Actor, store: AuthzStore): Promise<AuthzDecision> {
  if (actor.kind !== "user") {
    return { allow: false, reason: "service_actor_not_applicable" };
  }
  const assignments = await store.getActiveAssignments(actor.userId);
  return assignments.length > 0 ? { allow: true, reason: "granted" } : { allow: false, reason: "no_role_grant" };
}

/** Throwing variant of hasAnyRoleGrant. */
export async function requireAnyRoleGrant(actor: Actor, store: AuthzStore): Promise<void> {
  const decision = await hasAnyRoleGrant(actor, store);
  await recordAuditBestEffort(store, buildAuditEntry(actor, "any_role", null, decision));
  if (!decision.allow) {
    throw new AuthzDeniedError(decision.reason);
  }
}
