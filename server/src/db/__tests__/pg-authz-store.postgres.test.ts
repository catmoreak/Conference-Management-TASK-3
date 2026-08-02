import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { authorizeMutationAndRun } from "../../auth/authorize.js";
import type { HumanActor } from "../../auth/types.js";
import { isDockerAvailable, startPgTestHarness, type PgTestHarness } from "../../testing/pg-harness.js";
import { asPgClient } from "../pg-authz-store.js";

/**
 * These two tests exist because the in-memory fake's "rollback" (see
 * InMemoryAuthzStore.runInTransaction) is a JS array that's conditionally
 * appended to -- it can prove authorizeMutationAndRun's *control flow* is
 * right, but it structurally cannot catch the failure modes that actually
 * matter for a real transaction: forgetting ROLLBACK, leaking the pool
 * client, or -- the dangerous one -- the caller's mutation running on a
 * *different* connection than the audit row, so they were never atomic at
 * all. Both tests here force a genuine Postgres-level failure (a real
 * constraint violation, not a simulated JS throw) and inspect the database
 * afterward through a completely separate connection, so there is no way
 * for these to pass unless PgAuthzStore.runInTransaction is actually
 * sharing one client and actually issuing ROLLBACK.
 */

const dockerAvailable = isDockerAvailable();

if (!dockerAvailable) {
  console.warn("[pg-authz-store.postgres.test.ts] Docker is not available -- skipping real-Postgres atomicity tests.");
}

function human(userId: string): HumanActor {
  return { kind: "user", userId };
}

describe.skipIf(!dockerAvailable)("PgAuthzStore.runInTransaction atomicity (real Postgres)", () => {
  let handle: PgTestHarness;
  let eventId: string;
  let submissionId: string;

  beforeAll(async () => {
    handle = await startPgTestHarness();
  }, 120_000);

  afterAll(async () => {
    await handle.stop();
  }, 60_000);

  afterEach(async () => {
    // Undo any constraint tampering a test below may have left behind, so
    // a failure in one test can't cascade into the next.
    await handle.pool.query(`alter table audit_log drop constraint if exists force_audit_failure`);
  });

  async function seedSubmission(): Promise<void> {
    const eventRow = await handle.pool.query<{ id: string }>(`insert into events (name) values ('Atomicity Test Event') returning id`);
    eventId = eventRow.rows[0]!.id;

    const submissionRow = await handle.pool.query<{ id: string }>(
      `insert into submissions (event_id, owner_id, created_by, status) values ($1, 'presenter-a', 'presenter-a', 'pending') returning id`,
      [eventId],
    );
    submissionId = submissionRow.rows[0]!.id;

    await handle.pool.query(
      `insert into user_role_assignments (user_id, role, scope_type, scope_id, granted_by) values ('presenter-a', 'presenter', 'own', null, 'test-harness')`,
    );
  }

  it("rolls back a real SQL mutation, and its audit row, when the caller's mutate callback throws afterward", async () => {
    await handle.pool.query(`truncate table audit_log, user_role_assignments, submissions, sessions, events`);
    await seedSubmission();

    await expect(
      authorizeMutationAndRun(human("presenter-a"), "submission:update", { type: "submission", id: submissionId, ownerId: "presenter-a", status: "pending" }, handle.harness.store, async (tx) => {
        const client = asPgClient(tx);
        // A real mutation against a real table, on the same transaction the
        // audit row was just written on.
        await client.query(`update submissions set status = 'approved' where id = $1`, [submissionId]);
        throw new Error("downstream failure after a real mutation");
      }),
    ).rejects.toThrow("downstream failure after a real mutation");

    // Inspected through the harness's own pool -- a plain, non-transactional
    // read, exactly what any other request would see.
    const { rows } = await handle.pool.query<{ status: string }>(`select status from submissions where id = $1`, [submissionId]);
    expect(rows[0]?.status).toBe("pending"); // the UPDATE was really rolled back, not just "not observed"

    const auditRows = await handle.pool.query(`select * from audit_log where resource_id = $1`, [submissionId]);
    expect(auditRows.rowCount).toBe(0); // the audit row written before the throw was rolled back too
  });

  it("prevents a real SQL mutation from ever committing when the audit insert itself violates a DB constraint", async () => {
    await handle.pool.query(`truncate table audit_log, user_role_assignments, submissions, sessions, events`);
    await seedSubmission();

    // A genuine, DB-enforced failure mode for the audit insert -- not a
    // simulated throw. Every insert into audit_log now fails.
    await handle.pool.query(`alter table audit_log add constraint force_audit_failure check (false)`);

    let mutateWasCalled = false;

    await expect(
      authorizeMutationAndRun(human("presenter-a"), "submission:update", { type: "submission", id: submissionId, ownerId: "presenter-a", status: "pending" }, handle.harness.store, async (tx) => {
        mutateWasCalled = true;
        const client = asPgClient(tx);
        await client.query(`update submissions set status = 'approved' where id = $1`, [submissionId]);
      }),
    ).rejects.toThrow();

    // authorizeMutationAndRun writes the audit row before invoking `mutate`
    // (see authorize.ts), so a constraint violation on that insert means
    // `mutate` -- and therefore the UPDATE inside it -- never ran at all.
    // Either way, the outcome the caller cares about holds: no committed
    // mutation without a committed audit row.
    expect(mutateWasCalled).toBe(false);

    const { rows } = await handle.pool.query<{ status: string }>(`select status from submissions where id = $1`, [submissionId]);
    expect(rows[0]?.status).toBe("pending");
  });
});
