// Verifies the two hand-written CHECK constraints on user_role_assignments
// actually reject what they're supposed to, rather than assuming the SQL
// matched intent. Creates one throwaway user (to satisfy the FK cleanly, so
// a CHECK failure can't be confused with an FK failure), runs the bad
// inserts, confirms they fail, runs a valid insert as a positive control,
// then deletes everything it created.
//
// Run: npx tsx scripts/verify-schema-constraints.ts
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

async function main() {
  const { db } = await import("../src/server/db");

  console.log("== setting up a throwaway test user ==");
  const testUser = await db.user.create({
    data: {
      id: "test-constraint-verification-user",
      name: "Constraint Test User",
      email: "constraint-test@example.invalid",
    },
  });
  console.log("  created:", testUser.id);

  try {
    console.log("\n== test A: invalid scope_type value (expect failure) ==");
    try {
      await db.$executeRawUnsafe(
        `insert into "user_role_assignments" (id, user_id, role, scope_type, scope_id, granted_by)
         values (gen_random_uuid()::text, $1, 'operator', 'bogus', null, 'test-script')`,
        testUser.id,
      );
      assert(false, "insert with scope_type='bogus' should have been rejected but succeeded");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log("  actual DB error:", message.split("\n")[0]);
      // NOT asserting on user_role_assignments_scope_type_check specifically:
      // scope_id_matches_scope_type's own CHECK only has branches for the 4
      // valid scope_type values, so ANY out-of-enum value fails it too,
      // unconditionally -- there's no row shape that violates ONLY
      // scope_type_check. Postgres reports whichever it evaluates first,
      // which isn't scope_type_check here. Both constraints correctly
      // agree the row is bad; asserting a specific constraint name for this
      // overlapping case would be asserting an implementation detail, not
      // the actual guarantee.
      assert(
        message.includes("user_role_assignments_scope_type_check") || message.includes("scope_id_matches_scope_type"),
        "failure is one of the two relevant check constraints (not some unrelated error)",
      );
    }

    console.log("\n== test B: scope_type/scope_id mismatch -- 'event' with NULL scope_id (expect failure) ==");
    try {
      await db.$executeRawUnsafe(
        `insert into "user_role_assignments" (id, user_id, role, scope_type, scope_id, granted_by)
         values (gen_random_uuid()::text, $1, 'operator', 'event', null, 'test-script')`,
        testUser.id,
      );
      assert(false, "insert with scope_type='event' and scope_id=NULL should have been rejected but succeeded");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log("  actual DB error:", message.split("\n")[0]);
      assert(
        message.includes("scope_id_matches_scope_type"),
        "failure is specifically the scope_id_matches_scope_type constraint (not some unrelated error)",
      );
    }

    console.log("\n== test C: the OTHER mismatch direction -- 'global' with a non-NULL scope_id (expect failure) ==");
    try {
      await db.$executeRawUnsafe(
        `insert into "user_role_assignments" (id, user_id, role, scope_type, scope_id, granted_by)
         values (gen_random_uuid()::text, $1, 'operator', 'global', gen_random_uuid()::text, 'test-script')`,
        testUser.id,
      );
      assert(false, "insert with scope_type='global' and a non-NULL scope_id should have been rejected but succeeded");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log("  actual DB error:", message.split("\n")[0]);
      assert(
        message.includes("scope_id_matches_scope_type"),
        "failure is specifically the scope_id_matches_scope_type constraint",
      );
    }

    console.log("\n== positive control: a genuinely valid row (expect success) ==");
    const validRow = await db.$queryRawUnsafe<{ id: string }[]>(
      `insert into "user_role_assignments" (id, user_id, role, scope_type, scope_id, granted_by)
       values (gen_random_uuid()::text, $1, 'operator', 'global', null, 'test-script')
       returning id`,
      testUser.id,
    );
    assert(validRow.length === 1, "a correctly-shaped row (global scope, null scope_id) inserts successfully");
    if (validRow[0]) {
      await db.$executeRawUnsafe(`delete from "user_role_assignments" where id = $1`, validRow[0].id);
      console.log("  cleaned up the valid test row");
    }
  } finally {
    console.log("\n== cleaning up the throwaway test user ==");
    // Cascades to any leftover user_role_assignments rows for this user too.
    await db.user.delete({ where: { id: testUser.id } });
    const remaining = await db.$queryRawUnsafe<{ count: number }[]>(
      `select count(*)::int as count from "user_role_assignments" where user_id = $1`,
      testUser.id,
    );
    assert((remaining[0]?.count ?? -1) === 0, "no leftover user_role_assignments rows for the test user after cleanup");
    const userStillExists = await db.user.findUnique({ where: { id: testUser.id } });
    assert(userStillExists === null, "test user itself is fully deleted");
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
