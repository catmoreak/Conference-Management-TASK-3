// End-to-end live verification of the audit/route.ts shadow-check pilot --
// creates a real throwaway admin user, signs in via the actual better-auth
// HTTP endpoint to get a real session cookie, hits the ACTUAL running
// /api/audit route multiple times, and checks:
//   1. Response is identical to what legacy alone would produce (200, same
//      body shape) -- legacy stays authoritative, behavior unchanged.
//   2. A mismatch row landed in authz_shadow_mismatches (expected: no
//      real user_role_assignments data exists yet, see the comment in
//      audit/route.ts).
//   3. Rough per-request timing, to sanity-check there's no gross
//      regression from running both checks concurrently.
//
// Requires the Next.js dev server already running on BASE_URL.
// Run: npx tsx scripts/verify-audit-pilot-live.ts
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

const BASE_URL = process.env.PILOT_BASE_URL ?? "http://localhost:3000";
const TEST_EMAIL = "pilot-shadowcheck-test@example.invalid";
const TEST_PASSWORD = "PilotTest!2026Verify";

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
  const { auth } = await import("../src/server/better-auth");

  console.log("== creating a throwaway admin test user ==");
  await db.user.deleteMany({ where: { email: TEST_EMAIL } }); // in case a prior run left one
  const signUpResult = await auth.api.signUpEmail({
    body: { email: TEST_EMAIL, password: TEST_PASSWORD, name: "Pilot Shadow-Check Test User" },
  });
  const testUserId = signUpResult?.user?.id;
  if (!testUserId) throw new Error("signUpEmail did not return a user id");
  await db.user.update({ where: { id: testUserId }, data: { role: "admin", status: "active" } });
  console.log("  created user:", testUserId);

  console.log("\n== clearing any pre-existing shadow mismatch rows for this check ==");
  await db.authzShadowMismatch.deleteMany({ where: { checkName: "audit/route:dashboard-view", actorId: testUserId } });

  console.log("\n== signing in via the real HTTP endpoint to get a session cookie ==");
  const signInResponse = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  if (!signInResponse.ok) {
    console.log("  sign-in failure body:", await signInResponse.clone().text());
  }
  assert(signInResponse.ok, `sign-in succeeded (status ${signInResponse.status})`);
  const setCookieHeader = signInResponse.headers.get("set-cookie");
  assert(setCookieHeader !== null, "sign-in response set a session cookie");
  // Node's fetch exposes only the first Set-Cookie header via .get(); for a
  // single cookie (the common case here) that's enough to replay.
  const sessionCookie = setCookieHeader?.split(";")[0] ?? "";

  console.log("\n== hitting the real /api/audit route with that session ==");
  const timings: number[] = [];
  let lastStatus = 0;
  let lastBody: unknown;
  const REQUEST_COUNT = 8;
  for (let i = 0; i < REQUEST_COUNT; i++) {
    const start = performance.now();
    const res = await fetch(`${BASE_URL}/api/audit?limit=5`, {
      headers: { cookie: sessionCookie, origin: BASE_URL },
    });
    const elapsed = performance.now() - start;
    timings.push(elapsed);
    lastStatus = res.status;
    lastBody = await res.json();
  }

  assert(lastStatus === 200, `route returns 200 for an admin user (legacy still allows via dashboard:view) -- got ${lastStatus}`);
  assert(Array.isArray(lastBody), "response body is the audit log array, unchanged shape from before the pilot was wired in");

  const avgMs = timings.reduce((a, b) => a + b, 0) / timings.length;
  const maxMs = Math.max(...timings);
  console.log(`  ${REQUEST_COUNT} requests -- avg ${avgMs.toFixed(1)}ms, max ${maxMs.toFixed(1)}ms, all: [${timings.map((t) => t.toFixed(0)).join(", ")}]ms`);

  console.log("\n== isolating what shadowCompare actually ADDS: the candidate side's own DB query cost ==");
  {
    const { PrismaAuthzStore } = await import("../src/server/auth/authz/prisma-store");
    const store = new PrismaAuthzStore();
    const candidateTimings: number[] = [];
    for (let i = 0; i < REQUEST_COUNT; i++) {
      const start = performance.now();
      await store.getActiveAssignments(testUserId);
      candidateTimings.push(performance.now() - start);
    }
    const candidateAvg = candidateTimings.reduce((a, b) => a + b, 0) / candidateTimings.length;
    console.log(
      `  candidate's own getActiveAssignments query -- avg ${candidateAvg.toFixed(1)}ms of the ~${avgMs.toFixed(0)}ms total`,
    );
    console.log(
      "  shadowCompare runs legacy and candidate CONCURRENTLY (Promise.all), not sequentially -- legacy is pure sync logic with zero I/O," +
        " so the added latency is bounded by roughly the candidate's own query time above, not the sum of both checks.",
    );
  }

  console.log("\n== checking authz_shadow_mismatches for the recorded disagreement ==");
  const mismatches = await db.authzShadowMismatch.findMany({
    where: { checkName: "audit/route:dashboard-view", actorId: testUserId },
    orderBy: { occurredAt: "desc" },
  });
  assert(mismatches.length === REQUEST_COUNT, `exactly ${REQUEST_COUNT} mismatch rows recorded, one per request (expected: candidate has no user_role_assignments data yet)`);
  if (mismatches[0]) {
    assert(mismatches[0].legacyAllowed === true, "recorded mismatch: legacy allowed (admin via old role column)");
    assert(mismatches[0].candidateAllowed === false, "recorded mismatch: candidate denied (no_role_grant -- expected, no backfill yet)");
    assert(
      mismatches[0].candidateReason?.includes("no_role_grant") ?? false,
      `candidate's recorded reason is 'no_role_grant' as expected -- actual: ${mismatches[0].candidateReason}`,
    );
  }

  console.log("\n== cleaning up ==");
  await db.authzShadowMismatch.deleteMany({ where: { checkName: "audit/route:dashboard-view", actorId: testUserId } });
  await db.session.deleteMany({ where: { userId: testUserId } });
  await db.account.deleteMany({ where: { userId: testUserId } });
  await db.user.delete({ where: { id: testUserId } });
  const remaining = await db.user.findUnique({ where: { id: testUserId } });
  assert(remaining === null, "test user and session fully cleaned up");

  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passCount} passed, ${failCount} failed`);
  await db.$disconnect();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("VERIFICATION SCRIPT CRASHED:", e);
  process.exit(1);
});
