// Verifies the resource resolvers (resolvers.ts) against real Prisma data --
// these need actual DB relations (LiveSession/Submission -> Event ->
// tenantId), unlike authorize.ts's pure decision logic. Creates throwaway
// Event/LiveSession/Submission rows, resolves them, confirms tenantId flows
// through correctly, then deletes everything it created.
//
// Run: npx tsx scripts/verify-authz-resolvers.ts
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
  const { resolveEventResource, resolveLiveSessionResource, resolveSubmissionResource } = await import(
    "../src/server/auth/authz/resolvers"
  );

  console.log("== setting up throwaway Event / LiveSession / Submission rows ==");
  const event = await db.event.create({ data: { tenantId: "tenant-resolver-test", name: "Resolver Test Event" } });
  const liveSession = await db.liveSession.create({ data: { eventId: event.id, name: "Resolver Test Session" } });
  const submissionWithSession = await db.submission.create({
    data: { eventId: event.id, liveSessionId: liveSession.id, ownerId: "owner-1", createdBy: "owner-1" },
  });
  const submissionWithoutSession = await db.submission.create({
    data: { eventId: event.id, ownerId: "owner-2", createdBy: "owner-2" },
  });
  console.log("  created event:", event.id, "liveSession:", liveSession.id, "submissions:", submissionWithSession.id, submissionWithoutSession.id);

  try {
    console.log("\n== resolveEventResource ==");
    const resolvedEvent = await resolveEventResource(event.id);
    assert(resolvedEvent !== null, "resolves an existing event");
    assert(resolvedEvent?.tenantId === "tenant-resolver-test", "event resource carries the correct tenantId");
    assert(resolvedEvent?.eventId === event.id, "event resource's eventId matches");

    const missingEvent = await resolveEventResource("00000000-0000-0000-0000-000000000000");
    assert(missingEvent === null, "resolving a non-existent event returns null, not a throw");

    console.log("\n== resolveLiveSessionResource ==");
    const resolvedSession = await resolveLiveSessionResource(liveSession.id);
    assert(resolvedSession !== null, "resolves an existing live session");
    assert(
      resolvedSession?.tenantId === "tenant-resolver-test",
      "live session resource's tenantId is derived through the Event relation, not stored directly",
    );
    assert(resolvedSession?.eventId === event.id, "live session resource carries its parent eventId");
    assert(resolvedSession?.sessionId === liveSession.id, "live session resource's sessionId is its own id");

    console.log("\n== resolveSubmissionResource (with a live session) ==");
    const resolvedSubWithSession = await resolveSubmissionResource(submissionWithSession.id);
    assert(resolvedSubWithSession !== null, "resolves an existing submission");
    assert(resolvedSubWithSession?.tenantId === "tenant-resolver-test", "submission resource's tenantId derived through Event relation");
    assert(resolvedSubWithSession?.ownerId === "owner-1", "submission resource carries ownerId");
    assert(resolvedSubWithSession?.sessionId === liveSession.id, "submission resource carries its liveSessionId as sessionId");
    assert(resolvedSubWithSession?.status === "pending", "submission resource carries its status, default 'pending'");

    console.log("\n== resolveSubmissionResource (event-only, no live session) ==");
    const resolvedSubNoSession = await resolveSubmissionResource(submissionWithoutSession.id);
    assert(resolvedSubNoSession !== null, "resolves a submission with no liveSessionId");
    assert(resolvedSubNoSession?.sessionId === undefined, "sessionId is undefined (not null) when the submission has no live session, matching AuthzResource's optional-field convention");
    assert(resolvedSubNoSession?.tenantId === "tenant-resolver-test", "still correctly derives tenantId via Event even with no live session");
  } finally {
    console.log("\n== cleaning up ==");
    await db.submission.deleteMany({ where: { eventId: event.id } });
    await db.liveSession.delete({ where: { id: liveSession.id } });
    await db.event.delete({ where: { id: event.id } });

    const remainingSubmissions = await db.submission.count({ where: { eventId: event.id } });
    const remainingEvent = await db.event.findUnique({ where: { id: event.id } });
    assert(remainingSubmissions === 0 && remainingEvent === null, "all throwaway rows fully cleaned up");
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
