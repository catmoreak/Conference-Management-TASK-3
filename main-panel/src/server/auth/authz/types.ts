/**
 * Ported from server/src/auth/types.ts. Not wired to any route yet -- see
 * shadow-check.ts for the mechanism step 4 will use to cut call sites over.
 *
 * Changes from server/'s original model, all additive:
 *   - RoleAssignment gains `tenantId` (null = platform-wide, matching
 *     tenant.ts's existing allowAdminCrossTenant escape hatch; non-null =
 *     scoped to one tenant).
 *   - AuthzResource gains `tenantId`, populated by resource resolvers
 *     (resolvers.ts) via the Event relation, never duplicated onto
 *     LiveSession/Submission directly so it can't drift from its parent.
 *   - AuthzStore.hasActiveOperatorForSession is renamed
 *     hasActiveOperatorForLiveSession -- "session" means better-auth's login
 *     session in this codebase; server/'s conference-session concept is
 *     LiveSession here. The scope_type string value itself ('session')
 *     stays unchanged -- it's a check-constraint discriminator, not a
 *     table/model reference.
 */

import type { Permission } from "./permissions";

export type Role =
  | "presenter"
  | "reception_staff"
  | "reviewer"
  | "operator"
  | "event_admin"
  | "system_admin";

export type ServiceId = "conversion-worker" | "malware-scanner" | "podium-app";

export type ScopeType = "global" | "event" | "session" | "own";

/** A row read from user_role_assignments (already filtered to non-revoked, non-expired). */
export interface RoleAssignment {
  role: Role;
  scopeType: ScopeType;
  /** null for 'global' and 'own', a uuid string for 'event' / 'session'. */
  scopeId: string | null;
  /** null = platform-wide grant, applies in every tenant. Non-null = scoped to exactly that tenant. */
  tenantId: string | null;
}

/** An authenticated human, resolved from a verified Better Auth session. */
export interface HumanActor {
  kind: "user";
  userId: string;
}

/**
 * A backend service acting on its own credential, never a Better Auth user.
 * `onBehalfOfSessionId` is set only by podium-app, which borrows its
 * authorization from a live operator assignment on that live session rather
 * than holding a standing grant of its own.
 */
export interface ServiceActor {
  kind: "service";
  serviceId: ServiceId;
  onBehalfOfSessionId?: string;
}

export type Actor = HumanActor | ServiceActor;

/**
 * The shape resource resolvers hand to canUserPerform. Only include the
 * fields that represent a scope dimension you intend to authorize against.
 * `tenantId` should always be populated by any resolver for a real,
 * persisted resource -- an unresolved tenantId on an existing resource is
 * treated as a hard deny for any tenant-scoped grant (see authorize.ts's
 * tenantMatches), not silently ignored.
 */
export interface AuthzResource {
  type: string;
  id: string;
  eventId?: string;
  sessionId?: string;
  ownerId?: string;
  status?: string;
  targetRole?: Role;
  tenantId?: string;
}

export interface AuthzDecision {
  allow: boolean;
  reason: string;
}

export interface AuditLogEntry {
  actorType: "user" | "service";
  actorId: string;
  permission: string;
  resourceType: string | null;
  resourceId: string | null;
  decision: "allow" | "deny";
  reason: string;
}

/**
 * The audit-log write handle exposed inside a transaction started by
 * AuthzStore.runInTransaction. Not used yet -- authorizeMutationAndRun's
 * port belongs to the audit-migration step, once AuthzAuditLog exists.
 * Kept here now so the AuthzStore interface shape is settled up front.
 */
export interface AuthzTransaction {
  recordAuditLog(entry: AuditLogEntry): Promise<void>;
  readonly connection: unknown;
}

/**
 * Port the authz core depends on. Kept deliberately dumb, same as server/'s
 * original -- it returns raw assignment rows and records audit entries, but
 * holds no policy (role -> permission mapping, scope matching, state guards
 * all live in authorize.ts / permissions.ts, not here).
 */
export interface AuthzStore {
  /**
   * All active role assignments for this user: excludes rows where
   * revoked_at is set and rows where expires_at has passed.
   */
  getActiveAssignments(userId: string): Promise<RoleAssignment[]>;
  /** Whether an active (non-revoked, non-expired) 'operator' assignment exists for this live session. */
  hasActiveOperatorForLiveSession(liveSessionId: string): Promise<boolean>;
  /** Best-effort write, used for denials and for non-mutating allows. Callers must not let a failure here block their own control flow. */
  recordAuditLog(entry: AuditLogEntry): Promise<void>;
  /** Runs `fn` in a single transaction and commits only if it resolves. */
  runInTransaction<T>(fn: (tx: AuthzTransaction) => Promise<T>): Promise<T>;
}

export type { Permission };
