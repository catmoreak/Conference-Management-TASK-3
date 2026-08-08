/**
 * Prisma-backed AuthzStore against user_role_assignments / authz_audit_log.
 * Not wired to any route yet.
 *
 * getActiveAssignments / hasActiveOperatorForLiveSession deliberately use
 * raw SQL with Postgres's own now() rather than Prisma's query builder with
 * a JS `new Date()` comparison -- this preserves server/'s original,
 * ADR-documented guarantee: the same clock that stamps expires_at via
 * `default now()` is the only clock ever consulted to check it, so no
 * client machine's clock drift (this Node process included) can extend or
 * shorten a grant. A naive `expiresAt: { gt: new Date() }` would silently
 * regress that property.
 */

import { db } from "~/server/db";
import type { Prisma } from "../../../../generated/prisma";
import { isPrismaMissingTableError } from "../prisma-errors";
import type { AuditLogEntry, AuthzStore, AuthzTransaction, Role, RoleAssignment, ScopeType } from "./types";

interface AssignmentRow {
  role: string;
  scope_type: string;
  scope_id: string | null;
  tenant_id: string | null;
}

function toRoleAssignment(row: AssignmentRow): RoleAssignment {
  return {
    role: row.role as Role,
    scopeType: row.scope_type as ScopeType,
    scopeId: row.scope_id,
    tenantId: row.tenant_id,
  };
}

function auditData(entry: AuditLogEntry) {
  return {
    actorType: entry.actorType,
    actorId: entry.actorId,
    permission: entry.permission,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    decision: entry.decision,
    reason: entry.reason,
  };
}

export class PrismaAuthzStore implements AuthzStore {
  async getActiveAssignments(userId: string): Promise<RoleAssignment[]> {
    let rows: AssignmentRow[];
    try {
      rows = await db.$queryRaw<AssignmentRow[]>`
        select role, scope_type, scope_id, tenant_id
          from user_role_assignments
         where user_id = ${userId}
           and revoked_at is null
           and (expires_at is null or expires_at > now())
      `;
    } catch (error) {
      if (isPrismaMissingTableError(error)) return [];
      throw error;
    }
    return rows.map(toRoleAssignment);
  }

  async hasActiveOperatorForLiveSession(liveSessionId: string): Promise<boolean> {
    let rows: { found: boolean }[];
    try {
      rows = await db.$queryRaw<{ found: boolean }[]>`
        select exists (
          select 1
            from user_role_assignments
           where role = 'operator'
             and scope_type = 'session'
             and scope_id = ${liveSessionId}
             and revoked_at is null
             and (expires_at is null or expires_at > now())
        ) as found
      `;
    } catch (error) {
      if (isPrismaMissingTableError(error)) return false;
      throw error;
    }
    return rows[0]?.found ?? false;
  }

  async recordAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      await db.authzAuditLog.create({ data: auditData(entry) });
    } catch (error) {
      if (isPrismaMissingTableError(error)) return;
      throw error;
    }
  }

  async runInTransaction<T>(fn: (tx: AuthzTransaction) => Promise<T>): Promise<T> {
    return db.$transaction(async (prismaTx) => {
      const tx: AuthzTransaction = {
        connection: prismaTx,
        recordAuditLog: async (entry) => {
          try {
            await prismaTx.authzAuditLog.create({ data: auditData(entry) });
          } catch (error) {
            if (isPrismaMissingTableError(error)) return;
            throw error;
          }
        },
      };
      return fn(tx);
    });
  }
}

/** Narrows AuthzTransaction.connection to the Prisma transaction client, for mutating handlers wired specifically to PrismaAuthzStore. */
export function asPrismaClient(tx: AuthzTransaction): Prisma.TransactionClient {
  return tx.connection as Prisma.TransactionClient;
}
