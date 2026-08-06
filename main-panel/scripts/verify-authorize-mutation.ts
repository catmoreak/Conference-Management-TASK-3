// Verifies authorizeMutationAndRun's transactional guarantee against REAL
// Postgres -- this specifically cannot be proven against InMemoryAuthzStore,
// which has no rollback semantics at all (its runInTransaction just calls
// the callback directly). Creates a throwaway tenant/event/submissions/
// users/grants, runs the four required scenarios, and cleans everything up.
//
// Run: npx tsx scripts/verify-authorize-mutation.ts
import fs from "fs";
import path from "path";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, "utf-8");
  envFile.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || "";
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      if (key && !process.env[key]) process.env[key] = value;
    }
  });
}

let passCount = 0;
let failCount = 0;
function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ok: ${label}`);
    passCount++;
  } else {
    console.log(`  FAIL: ${label}`);
    failCount++;
  }
}

const TENANT = "tenant-audit-mutation-test";

async function main() {
  const { db } = await import("../src/server/db");
  const { authorizeMutationAndRun, AuthzDeniedError } = await import("../src/server/auth/authz/authorize");
  const { PrismaAuthzStore, asPrismaClient } = await import("../src/server/auth/authz/prisma-store");
  const { resolveSubmissionResource } = await import("../src/server/auth/authz/resolvers");
  type Actor = import("../src/server/auth/authz/types").Actor;

  const store = new PrismaAuthzStore();

  console.log("== setting up throwaway tenant/event/users/grant/submissions ==");
  const event = await db.event.create({ data: { tenantId: TENANT, name: "Audit Mutation Test Event" } });

  const grantedUser = await db.user.create({ data: { id: "audit-mut-test-granted-user", name: "Granted", email: "granted@example.invalid" } });
  const ungrantedUser = await db.user.create({ data: { id: "audit-mut-test-ungranted-user", name: "Ungranted", email: "ungranted@example.invalid" } });

  // 'reviewer' has submission:approve, not 'event_admin' -- see
  // ROLE_PERMISSIONS in permissions.ts (event_admin gets submission:read/
  // download only).
  await db.$executeRaw`
    insert into user_role_assignments (id, user_id, role, tenant_id, scope_type, scope_id, granted_by)
    values (gen_random_uuid()::text, ${grantedUser.id}, 'reviewer', ${TENANT}, 'event', ${event.id}, 'test-script')
  `;

  const submissions = await Promise.all(
    Array.from({ length: 5 }, (_, i) => db.submission.create({ data: { eventId: event.id, ownerId: "owner", createdBy: "owner" } })),
  );
  const [s1, s2, s3, s4, s5] = submissions;
  console.log(
    "  event:", event.id,
    "| granted user:", grantedUser.id,
    "| ungranted user:", ungrantedUser.id,
    "| submissions:", submissions.map((s) => s.id),
  );

  const grantedActor: Actor = { kind: "user", userId: grantedUser.id };
  const ungrantedActor: Actor = { kind: "user", userId: ungrantedUser.id };

  async function auditRowFor(resourceId: string) {
    return db.authzAuditLog.findFirst({ where: { resourceId }, orderBy: { occurredAt: "desc" } });
  }

  try {
    console.log("\n== scenario 1: allow path -- audit row and mutation both commit ==");
    {
      const resource = await resolveSubmissionResource(s1!.id);
      const result = await authorizeMutationAndRun(grantedActor, "submission:approve", resource, store, async (tx) => {
        const client = asPrismaClient(tx);
        return client.submission.update({ where: { id: s1!.id }, data: { status: "approved" } });
      });
      assert(result.status === "approved", "mutation's return value reflects the committed update");

      const reloaded = await db.submission.findUnique({ where: { id: s1!.id } });
      assert(reloaded?.status === "approved", "submission status persisted as 'approved'");

      const audit = await auditRowFor(s1!.id);
      assert(audit !== null && audit.decision === "allow", "an 'allow' audit row exists for this resource");
    }

    console.log("\n== scenario 2: deny path -- audit written, mutation never runs, error shape matches route-handler expectations ==");
    {
      let mutateCallCount = 0;
      const resource = await resolveSubmissionResource(s2!.id);
      try {
        await authorizeMutationAndRun(ungrantedActor, "submission:approve", resource, store, async () => {
          mutateCallCount++;
          return "should never happen";
        });
        assert(false, "should have thrown for an ungranted actor");
      } catch (err) {
        assert(err instanceof AuthzDeniedError, "throws AuthzDeniedError");
        const shaped = err as { status?: number; error?: string };
        assert(shaped.status === 403, "thrown error has .status === 403, matching what route handlers already check");
        assert(typeof shaped.error === "string" && shaped.error.length > 0, "thrown error has a non-empty .error string, matching rbac.ts's shape");
      }
      assert(mutateCallCount === 0, "mutate() was never called");

      const reloaded = await db.submission.findUnique({ where: { id: s2!.id } });
      assert(reloaded?.status === "pending", "submission status untouched");

      const audit = await auditRowFor(s2!.id);
      assert(audit !== null && audit.decision === "deny", "a 'deny' audit row still exists -- denials are best-effort/non-transactional by design, written even though nothing else happened");
    }

    console.log("\n== scenario 3: mutation throws after authorization succeeds -- audit row rolls back too ==");
    {
      const resource = await resolveSubmissionResource(s3!.id);
      try {
        await authorizeMutationAndRun(grantedActor, "submission:approve", resource, store, async (tx) => {
          const client = asPrismaClient(tx);
          // Partially "succeeds" first, then blows up -- proving the whole
          // transaction unwinds, not just that the throw prevented a write
          // that never started.
          await client.submission.update({ where: { id: s3!.id }, data: { status: "approved" } });
          throw new Error("simulated failure inside the mutation");
        });
        assert(false, "should have propagated the mutation's own error");
      } catch (err) {
        assert(err instanceof Error && err.message === "simulated failure inside the mutation", "the mutation's OWN error propagates unchanged, not wrapped/swallowed");
      }

      const reloaded = await db.submission.findUnique({ where: { id: s3!.id } });
      assert(reloaded?.status === "pending", "submission status ROLLED BACK to 'pending' -- the partial update inside the failed transaction did not persist");

      const audit = await auditRowFor(s3!.id);
      assert(audit === null, "NO audit row exists for this resource -- the allow-decision audit write inside the transaction rolled back together with the mutation, not left orphaned");
    }

    console.log("\n== scenario 4: concurrent calls don't leave partial/cross-contaminated state ==");
    {
      let deniedMutateCallCount = 0;
      const resourceS4 = await resolveSubmissionResource(s4!.id);
      const resourceS5 = await resolveSubmissionResource(s5!.id);

      const results = await Promise.allSettled([
        authorizeMutationAndRun(grantedActor, "submission:approve", resourceS4, store, async (tx) =>
          asPrismaClient(tx).submission.update({ where: { id: s4!.id }, data: { status: "approved" } }),
        ),
        authorizeMutationAndRun(grantedActor, "submission:approve", resourceS5, store, async (tx) =>
          asPrismaClient(tx).submission.update({ where: { id: s5!.id }, data: { status: "approved" } }),
        ),
        authorizeMutationAndRun(ungrantedActor, "submission:approve", resourceS4, store, async () => {
          deniedMutateCallCount++;
          return "unreachable";
        }),
      ]);

      assert(results[0]?.status === "fulfilled", "concurrent call A (S4, granted) succeeded");
      assert(results[1]?.status === "fulfilled", "concurrent call B (S5, granted) succeeded");
      assert(results[2]?.status === "rejected", "concurrent call C (S4, ungranted) was rejected");
      assert(deniedMutateCallCount === 0, "the denied concurrent call's mutate() was never invoked");

      const s4Reloaded = await db.submission.findUnique({ where: { id: s4!.id } });
      const s5Reloaded = await db.submission.findUnique({ where: { id: s5!.id } });
      assert(s4Reloaded?.status === "approved", "S4 committed correctly despite a concurrent denied call targeting the same resource");
      assert(s5Reloaded?.status === "approved", "S5 committed correctly");

      const auditS4Allow = await db.authzAuditLog.findFirst({ where: { resourceId: s4!.id, decision: "allow" } });
      const auditS4Deny = await db.authzAuditLog.findFirst({ where: { resourceId: s4!.id, decision: "deny" } });
      assert(auditS4Allow !== null, "S4 has its allow audit row");
      assert(auditS4Deny !== null, "S4 ALSO has a separate deny audit row from the concurrent denied attempt -- both recorded, neither corrupted the other");
    }
  } finally {
    console.log("\n== cleaning up ==");
    await db.authzAuditLog.deleteMany({ where: { resourceId: { in: submissions.map((s) => s.id) } } });
    await db.submission.deleteMany({ where: { eventId: event.id } });
    await db.$executeRaw`delete from user_role_assignments where user_id in (${grantedUser.id}, ${ungrantedUser.id})`;
    await db.user.delete({ where: { id: grantedUser.id } });
    await db.user.delete({ where: { id: ungrantedUser.id } });
    await db.event.delete({ where: { id: event.id } });

    const leftoverSubmissions = await db.submission.count({ where: { eventId: event.id } });
    const leftoverEvent = await db.event.findUnique({ where: { id: event.id } });
    const leftoverGrants = await db.$queryRaw<{ count: number }[]>`select count(*)::int as count from user_role_assignments where user_id in (${grantedUser.id}, ${ungrantedUser.id})`;
    assert(
      leftoverSubmissions === 0 && leftoverEvent === null && (leftoverGrants[0]?.count ?? -1) === 0,
      "all throwaway rows fully cleaned up",
    );
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passCount} passed, ${failCount} failed`);
  await db.$disconnect();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("VERIFICATION SCRIPT CRASHED:", e);
  process.exit(1);
});
