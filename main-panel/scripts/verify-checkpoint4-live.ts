// Closes the two gaps verify-checkpoint3-live.ts explicitly left open:
// downloads/route.ts and ws/token/route.ts both gate on assertOnboardingComplete
// (MFA enrollment) BEFORE RBAC ever runs, and checkpoint3 could only prove
// they block there -- it never got a live look at the RBAC/shadowCompare
// logic itself.
//
// The trick checkpoint3's own comment ruled out ("set twoFactorEnabled:true
// before sign-in") triggers better-auth's real twoFactor PLUGIN mid-sign-in
// and kills the session. This script instead: signs in FIRST while
// twoFactorEnabled is still false (a normal, unchallenged sign-in), THEN
// flips twoFactorEnabled=true directly via Prisma on the already-issued
// session. getSession() re-reads the user row fresh on every call (no JWT
// caching), so the same cookie should now read as onboarding-complete
// without ever touching the plugin's TOTP challenge flow.
//
// Also live-exercises ws-authorize.ts's authorizeWsMessage against the real
// Prisma-backed store (no WS server exists yet to send an actual WS frame
// through -- see the report), and confirms presign-policy.ts's TTL constant.
//
// Requires the Next.js dev server running on BASE_URL.
// Run: npx tsx scripts/verify-checkpoint4-live.ts
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
const PASSWORD = "Checkpoint4Test!2026";

let passCount = 0;
let failCount = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`    ok: ${label}`); passCount++; }
  else { console.log(`    FAIL: ${label}`); failCount++; }
}

/**
 * better-auth's own rate limiter caps /sign-in/email at 5 requests per 60s
 * PER IP (see config.ts's customRules) -- a deliberate security control,
 * not something this test should weaken. That budget is shared across ALL
 * sign-in traffic from localhost, including verify-checkpoint3-live.ts's
 * own 3 sign-ins -- running either script twice in a row, or the two back
 * to back, can exceed 5 within the window. A short poll doesn't help here
 * (the window is keyed off the OLDEST request still inside it, not off
 * when *this* retry started), so wait the full window out instead.
 */
async function signInWithRetry(email: string, password: string): Promise<Response> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ email, password }),
    });
    if (res.status !== 429) return res;
    console.log(`    (rate-limited signing in as ${email}, waiting 65s for the window to clear -- retry ${attempt}/2)`);
    await new Promise((r) => setTimeout(r, 65_000));
  }
  throw new Error(`sign-in for ${email} still rate-limited after retries`);
}

const ACTORS = [
  { email: "cp4-admin@example.invalid", role: "admin" as const },
  { email: "cp4-staff@example.invalid", role: "reviewer" as const },
  { email: "cp4-presops@example.invalid", role: "presenter" as const },
];
const TENANT = "tenant-cp4-test";

async function main() {
  const { db } = await import("../src/server/db");
  const { auth } = await import("../src/server/better-auth");

  const allUserIds: string[] = [];

  try {
    console.log("== PART A: does sign-in-then-flip-2FA-after actually clear the onboarding gate? ==");
    const userIds: Record<string, string> = {};
    const cookies: Record<string, string> = {};

    for (const a of ACTORS) {
      await db.user.deleteMany({ where: { email: a.email } });
      const r = await auth.api.signUpEmail({ body: { email: a.email, password: PASSWORD, name: `CP4 ${a.role}` } });
      const id = r?.user?.id;
      if (!id) throw new Error(`signup failed for ${a.email}`);
      allUserIds.push(id);
      await db.user.update({ where: { id }, data: { role: a.role, tenantId: TENANT, status: "active" } });
      userIds[a.role] = id;

      // Sign in WHILE twoFactorEnabled is still false -- normal, unchallenged flow.
      const signIn = await signInWithRetry(a.email, PASSWORD);
      assert(signIn.ok, `${a.role}: sign-in succeeded before 2FA flag flip`);
      const signInBody = (await signIn.clone().json()) as Record<string, unknown>;
      assert(!("twoFactorRedirect" in signInBody), `${a.role}: sign-in did NOT trigger a TOTP challenge`);
      const cookie = signIn.headers.get("set-cookie")?.split(";")[0] ?? "";
      assert(cookie.length > 0, `${a.role}: got a session cookie`);
      cookies[a.role] = cookie;

      // NOW flip twoFactorEnabled + mustResetPassword directly, same session already issued.
      await db.user.update({ where: { id }, data: { twoFactorEnabled: true, mustResetPassword: false } });
    }

    console.log("\n== PART B: downloads/route.ts -- does RBAC actually run now? ==");
    for (const actor of ACTORS) {
      const cookie = cookies[actor.role]!;
      const hdrs = { cookie, origin: BASE_URL, "content-type": "application/json" };

      const res = await fetch(`${BASE_URL}/api/downloads`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ fileType: "display_package", fileId: "cp4-test-file", fileName: "test.pdf" }),
      });
      const body = (await res.json()) as { error?: string; message?: string };
      // material:download is granted to admin/staff/pres_ops_staff alike, so
      // RBAC should ALLOW for all three here -- the interesting failure mode
      // would be still blocking at "MFA enrollment required" (gate not
      // actually cleared) or an unexpected 500. Getting to the S3-not-configured
      // 501 IS the proof RBAC (and CSRF, and onboarding) all passed -- the
      // AWS SDK itself is an unrelated, pre-existing stub (see s3-client.ts)
      // that returns null even with S3 env vars set, so 200 is not reachable
      // in this environment regardless of authz correctness.
      const clearedMfaGate = !body.error?.includes("MFA");
      assert(clearedMfaGate, `downloads / ${actor.role}: did NOT block at the MFA gate (error="${body.error}") -- confirms the flip-after-sign-in technique works`);
      assert(res.status !== 500 || body.error === "Failed to generate download URL", `downloads / ${actor.role}: no unexpected crash (status=${res.status}, error="${body.error}")`);
      assert(res.status === 501, `downloads / ${actor.role}: RBAC allowed (material:download granted to this role) -- reached the S3-not-configured branch, status=${res.status}`);
    }

    // pres_ops_staff-specific restriction: allowed material:download in
    // general, but explicitly denied "original" files by a role check AFTER
    // RBAC passes -- exercises a real behavioral branch beyond the shadow wiring.
    {
      const cookie = cookies["presenter"]!;
      const res = await fetch(`${BASE_URL}/api/downloads`, {
        method: "POST",
        headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
        body: JSON.stringify({ fileType: "original", fileId: "cp4-test-file-2", fileName: "test.pdf" }),
      });
      const body = (await res.json()) as { error?: string };
      assert(res.status === 403 && !!body.error?.includes("cannot download original"), `downloads / pres_ops_staff: denied "original" file specifically (status=${res.status}, error="${body.error}")`);
    }

    // Unauthenticated: no cookie at all.
    {
      const res = await fetch(`${BASE_URL}/api/downloads`, {
        method: "POST",
        headers: { origin: BASE_URL, "content-type": "application/json" },
        body: JSON.stringify({ fileType: "display_package", fileId: "x", fileName: "x.pdf" }),
      });
      assert(res.status === 401, `downloads / unauthenticated: 401 (got ${res.status})`);
    }

    console.log("\n== PART C: ws/token/route.ts -- does RBAC actually run now? ==");
    for (const actor of ACTORS) {
      const cookie = cookies[actor.role]!;
      const hdrs = { cookie, origin: BASE_URL, "content-type": "application/json" };

      const res = await fetch(`${BASE_URL}/api/ws/token`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ liveSessionId: "00000000-0000-0000-0000-000000000001" }),
      });
      const body = (await res.json()) as { error?: string; token?: string; expiresIn?: number };
      const clearedMfaGate = !body.error?.includes("MFA");
      assert(clearedMfaGate, `ws/token / ${actor.role}: did NOT block at the MFA gate (error="${body.error}")`);
      // live-control:view is granted to all three legacy roles, so all three
      // should get a real token minted -- this IS the working end-to-end
      // path (unlike downloads, ws/token has no external stub blocking it).
      assert(res.status === 200 && typeof body.token === "string" && body.token.length > 20, `ws/token / ${actor.role}: minted a real token (status=${res.status})`);
      assert(body.expiresIn === 120, `ws/token / ${actor.role}: expiresIn is the route's DEFAULT_WS_TOKEN_TTL (120), got ${body.expiresIn}`);
    }

    // Unauthenticated: no cookie at all.
    {
      const res = await fetch(`${BASE_URL}/api/ws/token`, {
        method: "POST",
        headers: { origin: BASE_URL, "content-type": "application/json" },
        body: JSON.stringify({ liveSessionId: "00000000-0000-0000-0000-000000000001" }),
      });
      assert(res.status === 401, `ws/token / unauthenticated: 401 (got ${res.status})`);
    }

    console.log("\n== PART D: candidate-side (new authz module) denial, against the REAL Prisma store ==");
    {
      const { PrismaAuthzStore } = await import("../src/server/auth/authz/prisma-store");
      const { canUserPerform } = await import("../src/server/auth/authz/authorize");
      const store = new PrismaAuthzStore();

      // admin-1 has zero user_role_assignments rows (never backfilled in
      // this script) -- so the new module MUST deny playback:read for them
      // via a real DB round-trip, same shape as the actual candidate side
      // of ws/token:live-control-view's shadowCompare call.
      const adminId = userIds["admin"]!;
      const decision = await canUserPerform({ kind: "user", userId: adminId }, "playback:read", null, store);
      assert(!decision.allow && decision.reason === "no_role_grant", `candidate (live Prisma store) denies playback:read for a user with zero role assignments -- reason="${decision.reason}"`);

      // Now grant a real global operator assignment via raw SQL (same
      // shape backfill-role-assignments.ts would produce) and confirm the
      // SAME live store now allows it -- proves the deny above wasn't a
      // query bug returning empty for everything.
      await db.$executeRawUnsafe(
        `insert into user_role_assignments (id, user_id, role, tenant_id, scope_type, scope_id, granted_by) values (gen_random_uuid(), $1, 'operator', null, 'global', null, 'cp4-test-script')`,
        adminId,
      );
      const decision2 = await canUserPerform({ kind: "user", userId: adminId }, "playback:read", null, store);
      assert(decision2.allow, `candidate (live Prisma store) allows playback:read once a real global operator grant exists -- reason="${decision2.reason}"`);
    }

    console.log("\n== PART E: ws-authorize.ts's authorizeWsMessage, live against the real Prisma store ==");
    console.log("   (no WS server exists yet to send an actual WS frame through -- see the report for why)");
    {
      const { PrismaAuthzStore } = await import("../src/server/auth/authz/prisma-store");
      const { authorizeWsMessage, playbackMessageResolver } = await import("../src/server/auth/authz/ws-authorize");
      const store = new PrismaAuthzStore();

      const SESSION_A = "11111111-1111-1111-1111-111111111111";
      const SESSION_B = "22222222-2222-2222-2222-222222222222";
      const staffId = userIds["reviewer"]!;

      // staffId has zero role assignments -- deny.
      const connections1 = {
        getActor: async () => ({ kind: "user" as const, userId: staffId }),
      };
      const denied = await authorizeWsMessage(
        "conn-live-1",
        { type: "playback:next", payload: { sessionId: SESSION_A } },
        playbackMessageResolver,
        connections1,
        store,
      );
      assert(!denied.allow && denied.reason === "no_role_grant", `authorizeWsMessage (live): denies playback:next for a user with no role assignments -- reason="${denied.reason}"`);

      // Grant staffId a session-scoped operator assignment for SESSION_A specifically.
      await db.$executeRawUnsafe(
        `insert into user_role_assignments (id, user_id, role, tenant_id, scope_type, scope_id, granted_by) values (gen_random_uuid(), $1, 'operator', null, 'session', $2, 'cp4-test-script')`,
        staffId, SESSION_A,
      );

      const allowed = await authorizeWsMessage(
        "conn-live-2",
        { type: "playback:next", payload: { sessionId: SESSION_A } },
        playbackMessageResolver,
        connections1,
        store,
      );
      assert(allowed.allow, `authorizeWsMessage (live): allows a REAL playback-control message once a matching session-scoped grant exists -- reason="${allowed.reason}"`);

      // Same connection/actor, message targets a DIFFERENT session -- must be denied.
      const wrongSession = await authorizeWsMessage(
        "conn-live-2",
        { type: "playback:jump", payload: { sessionId: SESSION_B } },
        playbackMessageResolver,
        connections1,
        store,
      );
      assert(!wrongSession.allow && wrongSession.reason === "scope_mismatch", `authorizeWsMessage (live): denies the SAME grant against an unauthorized session -- reason="${wrongSession.reason}"`);

      // Unauthenticated connection.
      const noActor = { getActor: async () => null };
      const anon = await authorizeWsMessage(
        "conn-live-3",
        { type: "playback:next", payload: { sessionId: SESSION_A } },
        playbackMessageResolver,
        noActor,
        store,
      );
      assert(!anon.allow && anon.reason === "unauthenticated", `authorizeWsMessage (live): denies an unauthenticated connection -- reason="${anon.reason}"`);
    }

    console.log("\n== PART F: presign-policy.ts's TTL constant ==");
    {
      const { PRESIGNED_URL_TTL_SECONDS } = await import("../src/server/auth/authz/presign-policy");
      assert(PRESIGNED_URL_TTL_SECONDS === 300, `PRESIGNED_URL_TTL_SECONDS is 300 (got ${PRESIGNED_URL_TTL_SECONDS})`);
      const routeSrc = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/downloads/route.ts"), "utf-8");
      assert(routeSrc.includes('from "~/server/auth/authz/presign-policy"'), "downloads/route.ts imports the constant from presign-policy.ts (not a duplicated literal)");
      assert(!/const PRESIGNED_URL_TTL_SECONDS\s*=\s*300/.test(routeSrc), "downloads/route.ts no longer has its own duplicated literal");
    }

  } finally {
    console.log("\n== cleaning up ==");
    await db.$executeRawUnsafe(`delete from authz_audit_log where actor_id = any($1)`, allUserIds);
    for (const id of allUserIds) {
      await db.authzShadowMismatch.deleteMany({ where: { actorId: id } });
      await db.$executeRawUnsafe(`delete from user_role_assignments where user_id = $1`, id);
      await db.session.deleteMany({ where: { userId: id } });
      await db.account.deleteMany({ where: { userId: id } });
      await db.twoFactor.deleteMany({ where: { userId: id } });
      await db.user.delete({ where: { id } }).catch(() => {});
    }
    const remaining = await db.user.count({ where: { id: { in: allUserIds } } });
    assert(remaining === 0, "all CP4 demo users fully cleaned up");
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
