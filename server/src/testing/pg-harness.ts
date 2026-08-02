import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import type { AuditLogEntry, Role, ScopeType } from "../auth/types.js";
import { PgAuthzStore } from "../db/pg-authz-store.js";
import type { AuthzStoreHarness, SeededAssignmentHandle } from "./authz-store-harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "..", "..", "migrations", "0001_authz_core.sql");
const POSTGRES_IMAGE = "postgres:17-alpine";

/**
 * Cheap, synchronous probe so the Postgres contract suite can be skipped at
 * collection time (via describe.skipIf) in environments with no Docker,
 * instead of hanging or failing the whole test run trying to reach it.
 */
export function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export interface PgTestHarness {
  harness: AuthzStoreHarness;
  pool: Pool;
  stop(): Promise<void>;
}

/** Starts a throwaway Postgres container, applies the 0001 migration, and wraps a PgAuthzStore in the shared AuthzStoreHarness contract. */
export async function startPgTestHarness(): Promise<PgTestHarness> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });

  const migrationSql = readFileSync(MIGRATION_PATH, "utf8");
  await pool.query(migrationSql);

  const store = new PgAuthzStore(pool);

  const harness: AuthzStoreHarness = {
    store,

    async seedAssignment(userId: string, role: Role, scopeType: ScopeType, scopeId: string | null, expiresAt: Date | null = null): Promise<SeededAssignmentHandle> {
      const { rows } = await pool.query<{ id: string }>(
        `insert into user_role_assignments (user_id, role, scope_type, scope_id, granted_by, expires_at)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [userId, role, scopeType, scopeId, "test-harness", expiresAt],
      );
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("seedAssignment: insert returned no id");
      return id;
    },

    async revoke(handle: SeededAssignmentHandle): Promise<void> {
      await pool.query(`update user_role_assignments set revoked_at = now() where id = $1`, [handle as string]);
    },

    async getAuditLog(): Promise<AuditLogEntry[]> {
      const { rows } = await pool.query<AuditLogEntry>(
        `select actor_type as "actorType",
                actor_id as "actorId",
                permission,
                resource_type as "resourceType",
                resource_id as "resourceId",
                decision,
                reason
           from audit_log
          order by occurred_at asc`,
      );
      return rows;
    },

    async reset(): Promise<void> {
      await pool.query(`truncate table audit_log, user_role_assignments, submissions, sessions, events`);
    },
  };

  return {
    harness,
    pool,
    async stop(): Promise<void> {
      await pool.end();
      await container.stop();
    },
  };
}
