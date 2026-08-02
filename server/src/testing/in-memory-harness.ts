import type { Role, ScopeType } from "../auth/types.js";
import type { AuthzStoreHarness, SeededAssignmentHandle } from "./authz-store-harness.js";
import { InMemoryAuthzStore, type SeededAssignment } from "./in-memory-authz-store.js";

export function createInMemoryHarness(): AuthzStoreHarness {
  let backing = new InMemoryAuthzStore();

  return {
    get store() {
      return backing;
    },
    async seedAssignment(userId: string, role: Role, scopeType: ScopeType, scopeId: string | null, expiresAt: Date | null = null) {
      return backing.seedAssignment(userId, role, scopeType, scopeId, expiresAt);
    },
    async revoke(handle: SeededAssignmentHandle) {
      backing.revoke(handle as SeededAssignment);
    },
    async getAuditLog() {
      return [...backing.auditLog];
    },
    async reset() {
      backing = new InMemoryAuthzStore();
    },
  };
}
