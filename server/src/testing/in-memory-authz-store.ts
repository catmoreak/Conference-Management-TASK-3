import type { AuditLogEntry, AuthzStore, AuthzTransaction, Role, RoleAssignment, ScopeType } from "../auth/types.js";

export interface SeededAssignment extends RoleAssignment {
  userId: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/** Test double for AuthzStore. Holds seeded assignment rows in memory and records every audit entry so tests can assert on both the decision and what got logged. */
export class InMemoryAuthzStore implements AuthzStore {
  public readonly auditLog: AuditLogEntry[] = [];
  private readonly assignments: SeededAssignment[] = [];
  private auditWritesFail = false;

  seedAssignment(
    userId: string,
    role: Role,
    scopeType: ScopeType,
    scopeId: string | null,
    expiresAt: Date | null = null,
  ): SeededAssignment {
    const assignment: SeededAssignment = { userId, role, scopeType, scopeId, expiresAt, revokedAt: null };
    this.assignments.push(assignment);
    return assignment;
  }

  /** Revokes a previously-seeded assignment (by reference, as returned from seedAssignment) effective immediately. */
  revoke(assignment: SeededAssignment): void {
    assignment.revokedAt = new Date();
  }

  /** Makes every subsequent audit write (top-level and transactional) throw, to test callers' resilience/atomicity handling. */
  simulateAuditWriteFailures(fail: boolean): void {
    this.auditWritesFail = fail;
  }

  private isActive(a: SeededAssignment, now: Date): boolean {
    return a.revokedAt === null && (a.expiresAt === null || a.expiresAt > now);
  }

  async getActiveAssignments(userId: string): Promise<RoleAssignment[]> {
    const now = new Date();
    return this.assignments
      .filter((a) => a.userId === userId && this.isActive(a, now))
      .map(({ role, scopeType, scopeId }) => ({ role, scopeType, scopeId }));
  }

  async hasActiveOperatorForSession(sessionId: string): Promise<boolean> {
    const now = new Date();
    return this.assignments.some((a) => a.role === "operator" && a.scopeType === "session" && a.scopeId === sessionId && this.isActive(a, now));
  }

  async recordAuditLog(entry: AuditLogEntry): Promise<void> {
    if (this.auditWritesFail) {
      throw new Error("simulated audit_log insert failure");
    }
    this.auditLog.push(entry);
  }

  /**
   * Simulates a real transaction: audit rows written via `tx.recordAuditLog`
   * are buffered and only committed to `auditLog` if `fn` resolves. If `fn`
   * throws -- whether because the audit write itself failed or because the
   * caller's own mutation failed -- the buffered rows are discarded and the
   * error propagates, exactly like a ROLLBACK.
   */
  async runInTransaction<T>(fn: (tx: AuthzTransaction) => Promise<T>): Promise<T> {
    const buffered: AuditLogEntry[] = [];
    const tx: AuthzTransaction = {
      connection: null,
      recordAuditLog: async (entry) => {
        if (this.auditWritesFail) {
          throw new Error("simulated audit_log insert failure");
        }
        buffered.push(entry);
      },
    };
    const result = await fn(tx);
    this.auditLog.push(...buffered);
    return result;
  }
}
