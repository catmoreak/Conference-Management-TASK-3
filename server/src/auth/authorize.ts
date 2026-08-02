import type { NextFunction, Request, Response } from "express";
import { PRESIGNED_URL_TTL_SECONDS } from "./presign-policy.js";
import {
  ASSIGNABLE_BY_EVENT_ADMIN,
  PERMISSION_ALLOWED_SCOPES,
  ROLE_PERMISSIONS,
  SERVICE_CO_AUTH,
  SERVICE_PERMISSIONS,
  STATE_GUARDED_PERMISSIONS,
  isKnownPermission,
} from "./permissions.js";
import type {
  Actor,
  AuditLogEntry,
  AuthzDecision,
  AuthzResource,
  AuthzStore,
  AuthzTransaction,
  HumanActor,
  Permission,
  RoleAssignment,
  ScopeType,
  ServiceActor,
} from "./types.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Populated upstream by Cognito token-verification middleware (not
       * part of this authorization module). Absent for anonymous, invalid,
       * or expired-token requests -- requirePermission treats all three
       * identically: deny with reason 'unauthenticated'.
       */
      actor?: Actor;
    }
  }
}

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

/**
 * Writes an audit row without letting a failure there affect the caller.
 * This is the "denials may be fire-and-forget" path, also used for
 * non-mutating allows (plain reads/permission checks): audit-log health is
 * observability, not a gate on whether a read request can proceed. The
 * write is still awaited internally (for deterministic ordering / tests)
 * but any rejection is swallowed here, never propagated.
 */
export async function recordAuditBestEffort(store: AuthzStore, entry: AuditLogEntry): Promise<void> {
  try {
    await store.recordAuditLog(entry);
  } catch {
    // Deliberately swallowed: an audit-log outage must not take down
    // authorization decisions for reads or break denials. The store
    // implementation is expected to own its own retry/alerting for
    // persistent failures; this is defense in depth at the call site.
  }
}

function scopeMatches(
  assignment: RoleAssignment,
  allowedScopes: readonly ScopeType[],
  resource: AuthzResource | null,
  actor: HumanActor,
): boolean {
  if (assignment.scopeType === "global") return true;
  if (!resource) return false;
  if (!allowedScopes.includes(assignment.scopeType)) return false;
  switch (assignment.scopeType) {
    case "event":
      return resource.eventId !== undefined && resource.eventId === assignment.scopeId;
    case "session":
      return resource.sessionId !== undefined && resource.sessionId === assignment.scopeId;
    case "own":
      // scopeId is deliberately never read here: an 'own' assignment's
      // authority comes entirely from resource.ownerId === actor.userId, so
      // a malformed row carrying a non-null scopeId (violating the DB
      // check constraint) still can't leak into a match.
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
    return { allow: false, reason: "scope_mismatch" };
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
    const hasOperator = await store.hasActiveOperatorForSession(actor.onBehalfOfSessionId);
    if (!hasOperator) {
      return { allow: false, reason: "no_active_operator_for_session" };
    }
    return { allow: true, reason: "granted" };
  }

  return { allow: false, reason: "unhandled_co_auth" };
}

/**
 * Pure decision resolution -- no audit side effect. Exists so callers that
 * need audit-write atomicity with a mutation (authorizeMutationAndRun) can
 * write the audit row themselves, inside their own transaction, instead of
 * inheriting canUserPerform's best-effort write.
 */
async function evaluatePermission(actor: Actor, permission: string, resource: AuthzResource | null, store: AuthzStore): Promise<AuthzDecision> {
  if (!isKnownPermission(permission)) {
    return { allow: false, reason: "unknown_permission" };
  }
  return actor.kind === "service" ? resolveService(actor, permission, resource, store) : resolveHuman(actor, permission, resource, store);
}

/**
 * The single reusable authorization check for everything that isn't a
 * database mutation needing audit-write atomicity: permission-gated reads,
 * WebSocket messages, and (via authorizeAndPresign) presigned URL issuance.
 * Resolves both the role/service grant and the scope match in one call, and
 * always records an audit row -- allow or deny, including unknown
 * permissions -- but a failure to record it never changes the returned
 * decision or throws (see recordAuditBestEffort). Mutating actions that
 * need the audit row and the write to succeed or fail together should use
 * authorizeMutationAndRun instead.
 */
export async function canUserPerform(actor: Actor, permission: string, resource: AuthzResource | null, store: AuthzStore): Promise<AuthzDecision> {
  const decision = await evaluatePermission(actor, permission, resource, store);
  await recordAuditBestEffort(store, buildAuditEntry(actor, permission, resource, decision));
  return decision;
}

export class AuthzDeniedError extends Error {
  constructor(public readonly reason: string) {
    super(`authorization denied: ${reason}`);
    this.name = "AuthzDeniedError";
  }
}

/**
 * Check-then-act helper for gated side effects that are NOT database
 * mutations (e.g. minting an S3 presigned URL) -- the caller has no handle
 * to `action` except through here, so the check is structurally impossible
 * to skip. Audit writes here are best-effort, same as canUserPerform: there
 * is no mutation to keep them atomic with.
 */
export async function authorizeAndRun<T>(actor: Actor, permission: Permission, resource: AuthzResource | null, store: AuthzStore, action: () => Promise<T>): Promise<T> {
  const decision = await canUserPerform(actor, permission, resource, store);
  if (!decision.allow) {
    throw new AuthzDeniedError(decision.reason);
  }
  return action();
}

/**
 * Check-then-act helper for database mutations. Unlike authorizeAndRun,
 * the allow-decision audit row and the mutation are written in one
 * transaction: if `mutate` throws, the transaction rolls back and the audit
 * row is never persisted either, so there is never a committed mutation
 * with no audit trail, or a committed "allow" audit row for a mutation that
 * didn't happen. Denials are still best-effort/non-transactional (see
 * recordAuditBestEffort) since there is nothing to keep them atomic with.
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
 * Mints an S3 presigned URL only after an allow decision, and always with
 * PRESIGNED_URL_TTL_SECONDS -- callers cannot request a longer TTL through
 * this path. See presign-policy.ts for why the cap exists.
 */
export async function authorizeAndPresign<T>(
  actor: Actor,
  permission: Permission,
  resource: AuthzResource | null,
  store: AuthzStore,
  mintUrl: (ttlSeconds: number) => Promise<T>,
): Promise<T> {
  return authorizeAndRun(actor, permission, resource, store, () => mintUrl(PRESIGNED_URL_TTL_SECONDS));
}

export type ResourceResolver = (req: Request) => Promise<AuthzResource | null> | AuthzResource | null;

/**
 * Express middleware: deny by default, resolve the resource, run
 * canUserPerform, 403 on any denial. This is a fast preliminary gate --
 * cheap, non-transactional. For routes that perform a database mutation,
 * the handler itself should additionally call authorizeMutationAndRun
 * around the actual write, so the allow-audit row and the mutation commit
 * or fail together; this middleware alone does not provide that guarantee.
 */
export function requirePermission(permission: Permission, resolveResource: ResourceResolver, store: AuthzStore) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const actor = req.actor;
    if (!actor) {
      await recordAuditBestEffort(store, {
        actorType: "user",
        actorId: "anonymous",
        permission,
        resourceType: null,
        resourceId: null,
        decision: "deny",
        reason: "unauthenticated",
      });
      res.status(401).json({ error: "unauthenticated" });
      return;
    }

    const resource = await resolveResource(req);
    const decision = await canUserPerform(actor, permission, resource, store);
    if (!decision.allow) {
      res.status(403).json({ error: "forbidden", reason: decision.reason });
      return;
    }
    next();
  };
}
