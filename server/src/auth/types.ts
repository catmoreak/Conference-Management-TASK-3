import type { Permission } from "./permissions.js";

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
}

/** An authenticated human, resolved from a verified Cognito token. */
export interface HumanActor {
  kind: "user";
  userId: string;
}

/**
 * A backend service acting on its own credential (IAM/mTLS/service token),
 * never a Cognito user. `onBehalfOfSessionId` is set only by podium-app,
 * which borrows its authorization from a live operator assignment on that
 * session rather than holding a standing grant of its own.
 */
export interface ServiceActor {
  kind: "service";
  serviceId: ServiceId;
  onBehalfOfSessionId?: string;
}

export type Actor = HumanActor | ServiceActor;

/**
 * The shape resourceResolvers hand to canUserPerform. Only include the
 * fields that represent a scope dimension you intend to authorize against --
 * e.g. a playback resource must NOT carry eventId, or an event_admin's
 * event-scoped grant would satisfy a session-scoped permission (see the ADR
 * on scope cascade). Fields are optional per-resource-type, not per-call.
 */
export interface AuthzResource {
  type: string;
  id: string;
  eventId?: string;
  sessionId?: string;
  ownerId?: string;
  status?: string;
  /** Only meaningful for the staff:assign permission. */
  targetRole?: Role;
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
 * AuthzStore.runInTransaction. A real implementation ties this to the same
 * client/connection the caller's mutation runs on, so a single ROLLBACK
 * undoes the audit row and the mutation together.
 */
export interface AuthzTransaction {
  recordAuditLog(entry: AuditLogEntry): Promise<void>;
  /**
   * The store-specific connection/handle this transaction is running on
   * (e.g. a `pg` PoolClient for PgAuthzStore), so a mutating handler can run
   * its own query on the exact same transaction as the audit row. Typed as
   * `unknown` because AuthzStore is store-agnostic across implementations;
   * callers that know which store they're wired to assert the concrete
   * type at the call site. The in-memory store has no real connection and
   * sets this to `null` -- there is nothing for a caller to run a second
   * query against there, by construction.
   */
  readonly connection: unknown;
}

/**
 * Port the authz core depends on. A real implementation queries Postgres;
 * tests use an in-memory fake. Kept deliberately dumb -- it returns raw
 * assignment rows and records audit entries, but holds no policy (role ->
 * permission mapping, scope matching, state guards all live in
 * authorize.ts / permissions.ts, not here).
 */
export interface AuthzStore {
  /**
   * All active role assignments for this user: excludes rows where
   * revoked_at is set and rows where expires_at has passed. Both checks
   * happen here, at the store boundary -- the decision logic in
   * authorize.ts never sees a revoked or expired row, the same way it never
   * sees the raw expires_at/revoked_at columns at all.
   */
  getActiveAssignments(userId: string): Promise<RoleAssignment[]>;
  /** Whether an active (non-revoked, non-expired) 'operator' assignment exists for this session. */
  hasActiveOperatorForSession(sessionId: string): Promise<boolean>;
  /** Best-effort write, used for denials and for non-mutating allows. Callers must not let a failure here block the caller's own control flow. */
  recordAuditLog(entry: AuditLogEntry): Promise<void>;
  /**
   * Runs `fn` in a single transaction and commits only if it resolves.
   * Used exclusively by authorizeMutationAndRun: the allow-decision audit
   * row and the caller's mutation must both land, or neither does.
   */
  runInTransaction<T>(fn: (tx: AuthzTransaction) => Promise<T>): Promise<T>;
}

export type { Permission };
