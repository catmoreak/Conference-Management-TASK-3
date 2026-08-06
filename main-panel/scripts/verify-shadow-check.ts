// Standalone verification for shadowCompare's comparison logic, using dummy
// legacy/candidate checks and an in-memory logMismatch collector -- no live
// database needed (the real authz module this will eventually wrap doesn't
// exist yet; this only proves the harness itself is correct).
//
// Run: npx tsx scripts/verify-shadow-check.ts
import fs from "fs";
import path from "path";

// Same manual .env load as scripts/seed-admin.ts -- tsx doesn't auto-load
// .env the way Next.js does, and ~/server/db (imported transitively below)
// validates DATABASE_URL eagerly at module-load time via ~/env.
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, "utf-8");
  envFile.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || "";
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

// Type-only import is erased at compile time -- doesn't trigger the runtime
// module evaluation (and therefore doesn't need DATABASE_URL) the way a
// value import would. The value import happens inside main(), after the
// .env values above are already in process.env.
import type { MismatchLogEntry } from "../src/server/auth/shadow-check";
type ShadowCompare = typeof import("../src/server/auth/shadow-check").shadowCompare;

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

async function withCollector<T>(fn: (collected: MismatchLogEntry[], logMismatch: (e: MismatchLogEntry) => Promise<void>) => Promise<T>) {
  const collected: MismatchLogEntry[] = [];
  const logMismatch = async (e: MismatchLogEntry) => {
    collected.push(e);
  };
  const result = await fn(collected, logMismatch);
  return { result, collected };
}

async function scenario1_bothAllow(shadowCompare: ShadowCompare) {
  console.log("\n== both legacy and candidate allow: no mismatch, legacy's value returned ==");
  const { result, collected } = await withCollector(async (collected, logMismatch) => {
    return shadowCompare({
      checkName: "test:both-allow",
      actorId: "user-1",
      legacy: () => "legacy-value",
      candidate: () => "candidate-value",
      logMismatch,
    });
  });
  assert(result === "legacy-value", "shadowCompare returns the LEGACY value, not the candidate's");
  assert(collected.length === 0, "no mismatch logged when both agree (allow)");
}

async function scenario2_bothDeny(shadowCompare: ShadowCompare) {
  console.log("\n== both legacy and candidate deny: no mismatch, legacy's exact error re-thrown ==");
  const legacyError = { status: 403, error: "legacy says no" };
  const { collected } = await withCollector(async (collected, logMismatch) => {
    try {
      await shadowCompare({
        checkName: "test:both-deny",
        actorId: "user-2",
        legacy: () => { throw legacyError; },
        candidate: () => { throw { status: 403, error: "candidate says no" }; },
        logMismatch,
      });
      assert(false, "shadowCompare should have thrown");
    } catch (err) {
      assert(err === legacyError, "the exact original legacy error object is re-thrown (same reference, not a synthesized Error)");
    }
  });
  assert(collected.length === 0, "no mismatch logged when both agree (deny)");
}

async function scenario3_legacyAllowsCandidateDenies(shadowCompare: ShadowCompare) {
  console.log("\n== legacy allows, candidate denies: mismatch logged, legacy still wins (allow) ==");
  const { result, collected } = await withCollector(async (collected, logMismatch) => {
    return shadowCompare({
      checkName: "test:legacy-allow-candidate-deny",
      actorId: "user-3",
      legacy: () => "still-allowed",
      candidate: () => { throw { status: 403, error: "candidate is stricter" }; },
      logMismatch,
    });
  });
  assert(result === "still-allowed", "legacy's allow wins even though candidate would deny");
  assert(collected.length === 1, "exactly one mismatch logged");
  assert(collected[0]?.legacyAllowed === true && collected[0]?.candidateAllowed === false, "mismatch entry correctly records legacy=allow, candidate=deny");
  assert(collected[0]?.candidateReason === "candidate is stricter", "candidate's denial reason captured for the log");
}

async function scenario4_legacyDeniesCandidateAllows(shadowCompare: ShadowCompare) {
  console.log("\n== legacy denies, candidate allows: mismatch logged, legacy still wins (deny) -- the security-relevant direction ==");
  const legacyError = { status: 403, error: "legacy is stricter" };
  const { collected } = await withCollector(async (collected, logMismatch) => {
    try {
      await shadowCompare({
        checkName: "test:legacy-deny-candidate-allow",
        actorId: "user-4",
        legacy: () => { throw legacyError; },
        candidate: () => "candidate-would-allow",
        logMismatch,
      });
      assert(false, "shadowCompare should have thrown (legacy denies)");
    } catch (err) {
      assert(err === legacyError, "legacy's denial wins even though candidate would allow -- no accidental privilege escalation from the shadow check");
    }
  });
  assert(collected.length === 1, "exactly one mismatch logged");
  assert(collected[0]?.legacyAllowed === false && collected[0]?.candidateAllowed === true, "mismatch entry correctly records legacy=deny, candidate=allow");
}

async function scenario5_candidateThrowsUnexpectedly(shadowCompare: ShadowCompare) {
  console.log("\n== candidate throws a non-rbac-shaped error (e.g. a bug, not a real denial): still just observed, never breaks the caller ==");
  const { result } = await withCollector(async (collected, logMismatch) => {
    return shadowCompare({
      checkName: "test:candidate-bug",
      actorId: "user-5",
      legacy: () => 42,
      candidate: () => { throw new Error("unrelated bug in the not-yet-finished candidate module"); },
      logMismatch,
    });
  });
  assert(result === 42, "a broken candidate never affects the caller's result during the shadow period");
}

async function main() {
  const { shadowCompare } = await import("../src/server/auth/shadow-check");

  await scenario1_bothAllow(shadowCompare);
  await scenario2_bothDeny(shadowCompare);
  await scenario3_legacyAllowsCandidateDenies(shadowCompare);
  await scenario4_legacyDeniesCandidateAllows(shadowCompare);
  await scenario5_candidateThrowsUnexpectedly(shadowCompare);

  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("VERIFICATION SCRIPT CRASHED:", err);
  process.exit(1);
});
