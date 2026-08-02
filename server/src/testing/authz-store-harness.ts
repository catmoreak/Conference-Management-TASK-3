import type { AuditLogEntry, AuthzStore, Role, ScopeType } from "../auth/types.js";

/**
 * Opaque handle returned by seedAssignment, passed back to revoke. Each
 * harness implementation decides what it actually is (an object reference
 * for the in-memory fake, a row id for Postgres) -- the contract suite
 * never inspects it.
 */
export type SeededAssignmentHandle = unknown;

/**
 * Fixture-management surface a store needs beyond the production AuthzStore
 * interface for it to be exercised by the shared contract suite: seeding
 * and revoking role assignments, and reading back the audit log. None of
 * this exists on AuthzStore itself because authorize.ts never needs to
 * enumerate or seed grants -- only a test harness does.
 */
export interface AuthzStoreHarness {
  readonly store: AuthzStore;
  seedAssignment(
    userId: string,
    role: Role,
    scopeType: ScopeType,
    scopeId: string | null,
    expiresAt?: Date | null,
  ): Promise<SeededAssignmentHandle>;
  revoke(handle: SeededAssignmentHandle): Promise<void>;
  getAuditLog(): Promise<AuditLogEntry[]>;
  /** Clears all fixture state between tests. Cheap for the in-memory fake; a TRUNCATE for Postgres. */
  reset(): Promise<void>;
}
