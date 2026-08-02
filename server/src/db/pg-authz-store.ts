import type { Pool, PoolClient } from "pg";
import type { AuditLogEntry, AuthzStore, AuthzTransaction, Role, RoleAssignment, ScopeType } from "../auth/types.js";

interface AssignmentRow {
  role: string;
  scope_type: string;
  scope_id: string | null;
}

const INSERT_AUDIT_LOG_SQL = `
  insert into audit_log (actor_type, actor_id, permission, resource_type, resource_id, decision, reason)
  values ($1, $2, $3, $4, $5, $6, $7)
`;

function auditLogParams(entry: AuditLogEntry): (string | null)[] {
  return [entry.actorType, entry.actorId, entry.permission, entry.resourceType, entry.resourceId, entry.decision, entry.reason];
}

/**
 * Postgres-backed AuthzStore against the 0001 migration. Every "is this
 * grant still active" question is answered inside the SQL WHERE clause,
 * evaluated by the Postgres server's own clock (`now()`) -- never by
 * fetching rows and comparing against a JS Date. That's deliberate: the
 * same clock that stamps expires_at/revoked_at via `default now()` is the
 * only clock ever consulted to check them, so no client machine's clock
 * drift (a podium laptop, this Node process, anything) can extend or
 * shorten a grant. See ADR 0001.
 */
export class PgAuthzStore implements AuthzStore {
  constructor(private readonly pool: Pool) {}

  async getActiveAssignments(userId: string): Promise<RoleAssignment[]> {
    const { rows } = await this.pool.query<AssignmentRow>(
      `select role, scope_type, scope_id
         from user_role_assignments
        where user_id = $1
          and revoked_at is null
          and (expires_at is null or expires_at > now())`,
      [userId],
    );
    return rows.map((row) => ({
      role: row.role as Role,
      scopeType: row.scope_type as ScopeType,
      scopeId: row.scope_id,
    }));
  }

  async hasActiveOperatorForSession(sessionId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ found: boolean }>(
      `select exists (
         select 1
           from user_role_assignments
          where role = 'operator'
            and scope_type = 'session'
            and scope_id = $1
            and revoked_at is null
            and (expires_at is null or expires_at > now())
       ) as found`,
      [sessionId],
    );
    return rows[0]?.found ?? false;
  }

  async recordAuditLog(entry: AuditLogEntry): Promise<void> {
    await this.pool.query(INSERT_AUDIT_LOG_SQL, auditLogParams(entry));
  }

  /**
   * Checks out a single client, BEGINs, hands that same client to `fn`
   * (both for the audit insert and for the caller's own mutation via
   * `tx.connection`), then COMMITs on success or ROLLBACKs on any throw --
   * including a throw from the audit insert itself. The client is always
   * released in `finally`, so a throw anywhere in `fn` (or in COMMIT/
   * ROLLBACK) can never leak it back to the pool checked out and forgotten.
   */
  async runInTransaction<T>(fn: (tx: AuthzTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const tx: AuthzTransaction = {
        connection: client,
        recordAuditLog: async (entry) => {
          await client.query(INSERT_AUDIT_LOG_SQL, auditLogParams(entry));
        },
      };

      let result: T;
      try {
        result = await fn(tx);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }

      await client.query("COMMIT");
      return result;
    } finally {
      client.release();
    }
  }
}

/** Narrows AuthzTransaction.connection to the pg client, for mutating handlers wired specifically to PgAuthzStore. */
export function asPgClient(tx: AuthzTransaction): PoolClient {
  return tx.connection as PoolClient;
}
