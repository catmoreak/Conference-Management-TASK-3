// Since the dev DB has ZERO real users, this creates clearly-labeled
// SYNTHETIC demo users (one per old role, covering the interesting tenant
// cases), runs the real backfill-role-assignments.ts script against them,
// then re-runs the audit/route.ts pilot check for each to show:
//   - admin (with and without tenantId): mismatch should DISAPPEAR
//   - staff / pres_ops_staff: mismatch should PERSIST -- audit:read is
//     system_admin-only in the new catalogue, a real gap, not missing data
// Cleans up all synthetic users/grants/sessions afterward.
//
// Requires the Next.js dev server running on BASE_URL.
// Run: npx tsx scripts/demo-backfill-and-repilot.ts
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

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

const BASE_URL = process.env.PILOT_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "DemoBackfillTest!2026";

let passCount = 0;
let failCount = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ok: ${label}`); passCount++; }
  else { console.log(`  FAIL: ${label}`); failCount++; }
}

const DEMO_USERS = [
  { email: "demo-admin-tenant@example.invalid", role: "admin" as const, tenantId: "tenant-demo-a", expectMismatchAfterBackfill: false },
  { email: "demo-admin-notenant@example.invalid", role: "admin" as const, tenantId: null, expectMismatchAfterBackfill: false },
  // audit:read was added to event_admin/operator since this script was
  // first written -- both now expected to resolve cleanly too.
  { email: "demo-staff@example.invalid", role: "reviewer" as const, tenantId: "tenant-demo-a", expectMismatchAfterBackfill: false },
  { email: "demo-presops@example.invalid", role: "presenter" as const, tenantId: "tenant-demo-a", expectMismatchAfterBackfill: false },
];

async function main() {
  const { db } = await import("../src/server/db");
  const { auth } = await import("../src/server/better-auth");

  console.log("== creating synthetic demo users (clearly not real production data) ==");
  const createdUserIds: string[] = [];
  for (const spec of DEMO_USERS) {
    await db.user.deleteMany({ where: { email: spec.email } });
    const result = await auth.api.signUpEmail({ body: { email: spec.email, password: PASSWORD, name: `Demo ${spec.role}` } });
    const userId = result?.user?.id;
    if (!userId) throw new Error(`signUpEmail failed for ${spec.email}`);
    await db.user.update({ where: { id: userId }, data: { role: spec.role, tenantId: spec.tenantId, status: "active" } });
    createdUserIds.push(userId);
    console.log(`  ${spec.email} -> ${userId} (role=${spec.role}, tenantId=${spec.tenantId ?? "null"})`);
  }

  try {
    console.log("\n== running the real backfill script (dry run first) ==");
    console.log(execSync("npx tsx scripts/backfill-role-assignments.ts", { encoding: "utf-8" }));

    console.log("\n== running the real backfill script (--apply) ==");
    console.log(execSync("npx tsx scripts/backfill-role-assignments.ts --apply", { encoding: "utf-8" }));

    console.log("\n== re-running the audit/route.ts pilot for each demo user ==");
    for (const spec of DEMO_USERS) {
      console.log(`\n  -- ${spec.email} (${spec.role}) --`);

      const user = await db.user.findUniqueOrThrow({ where: { email: spec.email } });
      await db.authzShadowMismatch.deleteMany({ where: { checkName: "audit/route:dashboard-view", actorId: user.id } });

      const signInResponse = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL },
        body: JSON.stringify({ email: spec.email, password: PASSWORD }),
      });
      assert(signInResponse.ok, "sign-in succeeded");
      const cookie = signInResponse.headers.get("set-cookie")?.split(";")[0] ?? "";

      const auditResponse = await fetch(`${BASE_URL}/api/audit?limit=5`, { headers: { cookie, origin: BASE_URL } });
      assert(auditResponse.status === 200, `route still returns 200 (legacy authoritative, unchanged) -- got ${auditResponse.status}`);

      const mismatches = await db.authzShadowMismatch.findMany({ where: { checkName: "audit/route:dashboard-view", actorId: user.id } });

      if (spec.expectMismatchAfterBackfill) {
        assert(mismatches.length === 1, `${spec.role}: mismatch STILL PRESENT as expected (audit:read is system_admin-only in the new catalogue -- a real gap, not missing data)`);
        if (mismatches[0]) {
          console.log(`    legacy=${mismatches[0].legacyAllowed} candidate=${mismatches[0].candidateAllowed} candidateReason="${mismatches[0].candidateReason}"`);
        }
      } else {
        assert(mismatches.length === 0, `${spec.role}: mismatch RESOLVED after backfill -- new module now agrees with legacy`);
      }
    }
  } finally {
    console.log("\n== cleaning up all synthetic demo data ==");
    for (const userId of createdUserIds) {
      await db.authzShadowMismatch.deleteMany({ where: { actorId: userId } });
      await db.$executeRawUnsafe(`delete from user_role_assignments where user_id = $1`, userId);
      await db.session.deleteMany({ where: { userId } });
      await db.account.deleteMany({ where: { userId } });
      await db.user.delete({ where: { id: userId } });
    }
    const remaining = await db.user.count({ where: { email: { in: DEMO_USERS.map((d) => d.email) } } });
    assert(remaining === 0, "all synthetic demo users and their grants fully cleaned up");
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passCount} passed, ${failCount} failed`);
  await db.$disconnect();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("SCRIPT CRASHED:", e);
  process.exit(1);
});
