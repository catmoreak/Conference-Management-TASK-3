/**
 * Fast, DB-free AuthzStore for testing the decision logic in authorize.ts
 * without touching Postgres -- mirrors server/'s testing/in-memory-authz-store.ts.
 * Not used by anything live; the Prisma-backed store (needed for real
 * queries against user_role_assignments) is deferred to the audit-migration
 * step, where its transactional shape actually gets decided.
 */

import type { AuditLogEntry, AuthzStore, AuthzTransaction, RoleAssignment } from "./types";

export class InMemoryAuthzStore implements AuthzStore {
  private assignmentsByUser = new Map<string, RoleAssignment[]>();
  private operatorLiveSessions = new Set<string>();
  public auditLog: AuditLogEntry[] = [];

  setAssignments(userId: string, assignments: RoleAssignment[]): void {
    this.assignmentsByUser.set(userId, assignments);
  }

  setOperatorForLiveSession(liveSessionId: string, active: boolean): void {
    if (active) this.operatorLiveSessions.add(liveSessionId);
    else this.operatorLiveSessions.delete(liveSessionId);
  }

  async getActiveAssignments(userId: string): Promise<RoleAssignment[]> {
    return this.assignmentsByUser.get(userId) ?? [];
  }

  async hasActiveOperatorForLiveSession(liveSessionId: string): Promise<boolean> {
    return this.operatorLiveSessions.has(liveSessionId);
  }

  async recordAuditLog(entry: AuditLogEntry): Promise<void> {
    this.auditLog.push(entry);
  }

  async runInTransaction<T>(fn: (tx: AuthzTransaction) => Promise<T>): Promise<T> {
    const tx: AuthzTransaction = {
      connection: null,
      recordAuditLog: async (entry) => {
        this.auditLog.push(entry);
      },
    };
    return fn(tx);
  }
}
