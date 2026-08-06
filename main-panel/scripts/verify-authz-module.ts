// Verifies authorize.ts's decision logic, including the new tenant
// precondition, using InMemoryAuthzStore -- no live database needed for any
// of this (resource resolvers, which do need Prisma, are verified
// separately in verify-authz-resolvers.ts).
//
// Run: npx tsx scripts/verify-authz-module.ts
import { canUserPerform } from "../src/server/auth/authz/authorize";
import { InMemoryAuthzStore } from "../src/server/auth/authz/in-memory-store";
import type { AuthzResource, HumanActor, RoleAssignment, ServiceActor } from "../src/server/auth/authz/types";

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

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

async function main() {
  console.log("== basic role permission check ==");
  {
    const store = new InMemoryAuthzStore();
    const presenter: HumanActor = { kind: "user", userId: "u1" };
    store.setAssignments("u1", [{ role: "presenter", scopeType: "own", scopeId: null, tenantId: TENANT_A }]);

    // 'own' scope, like every non-global scope, requires SOME resource to
    // check against -- inherited unchanged from server/'s original
    // scopeMatches (`if (!resource) return false`), not something this
    // port introduced. For a create, the caller constructs a PROPOSED
    // resource with ownerId prefilled to the actor's own id, representing
    // what's about to be created -- not a literal null.
    const proposedSubmission: AuthzResource = { type: "submission", id: "pending", eventId: "event-A", ownerId: "u1", tenantId: TENANT_A };
    const canCreate = await canUserPerform(presenter, "submission:create", proposedSubmission, store);
    assert(canCreate.allow, "presenter can submission:create when the proposed resource's ownerId is their own id");

    const cannotCreateForSomeoneElse = await canUserPerform(
      presenter,
      "submission:create",
      { type: "submission", id: "pending", eventId: "event-A", ownerId: "someone-else", tenantId: TENANT_A },
      store,
    );
    assert(!cannotCreateForSomeoneElse.allow, "presenter cannot submission:create a proposed resource owned by someone else");

    const cannotCreateEvent = await canUserPerform(presenter, "event:create", null, store);
    assert(!cannotCreateEvent.allow && cannotCreateEvent.reason === "no_role_grant", "presenter cannot event:create (no_role_grant)");
  }

  console.log("\n== event scope matching ==");
  {
    const store = new InMemoryAuthzStore();
    const admin: HumanActor = { kind: "user", userId: "u2" };
    store.setAssignments("u2", [{ role: "event_admin", scopeType: "event", scopeId: "event-A", tenantId: TENANT_A }]);

    const ownEvent: AuthzResource = { type: "event", id: "event-A", eventId: "event-A", tenantId: TENANT_A };
    const otherEvent: AuthzResource = { type: "event", id: "event-B", eventId: "event-B", tenantId: TENANT_A };

    const canUpdateOwn = await canUserPerform(admin, "event:update", ownEvent, store);
    assert(canUpdateOwn.allow, "event_admin scoped to event-A can event:update event-A");

    const cannotUpdateOther = await canUserPerform(admin, "event:update", otherEvent, store);
    assert(!cannotUpdateOther.allow && cannotUpdateOther.reason === "scope_mismatch", "event_admin scoped to event-A cannot event:update event-B (scope_mismatch, same tenant)");
  }

  console.log("\n== own scope matching ==");
  {
    const store = new InMemoryAuthzStore();
    const presenter: HumanActor = { kind: "user", userId: "u3" };
    store.setAssignments("u3", [{ role: "presenter", scopeType: "own", scopeId: null, tenantId: TENANT_A }]);

    const ownSubmission: AuthzResource = { type: "submission", id: "s1", eventId: "event-A", ownerId: "u3", tenantId: TENANT_A };
    const othersSubmission: AuthzResource = { type: "submission", id: "s2", eventId: "event-A", ownerId: "someone-else", tenantId: TENANT_A };

    const canUpdateOwn = await canUserPerform(presenter, "submission:update", ownSubmission, store);
    assert(canUpdateOwn.allow, "presenter can submission:update their own submission");

    const cannotUpdateOthers = await canUserPerform(presenter, "submission:update", othersSubmission, store);
    assert(!cannotUpdateOthers.allow, "presenter cannot submission:update someone else's submission");
  }

  console.log("\n== session scope matching ==");
  {
    const store = new InMemoryAuthzStore();
    const operator: HumanActor = { kind: "user", userId: "u4" };
    store.setAssignments("u4", [{ role: "operator", scopeType: "session", scopeId: "session-X", tenantId: TENANT_A }]);

    const sessionX: AuthzResource = { type: "session", id: "session-X", sessionId: "session-X", eventId: "event-A", tenantId: TENANT_A };
    const sessionY: AuthzResource = { type: "session", id: "session-Y", sessionId: "session-Y", eventId: "event-A", tenantId: TENANT_A };

    const canControlX = await canUserPerform(operator, "playback:control", sessionX, store);
    assert(canControlX.allow, "operator scoped to session-X can playback:control session-X");

    const cannotControlY = await canUserPerform(operator, "playback:control", sessionY, store);
    assert(!cannotControlY.allow, "operator scoped to session-X cannot playback:control session-Y");
  }

  console.log("\n== TENANT PRECONDITION: the new axis this reconciliation adds ==");
  {
    const store = new InMemoryAuthzStore();
    const admin: HumanActor = { kind: "user", userId: "u5" };
    // Same role, same scopeId shape, but granted in tenant A.
    store.setAssignments("u5", [{ role: "event_admin", scopeType: "event", scopeId: "event-shared-id", tenantId: TENANT_A }]);

    const resourceInTenantA: AuthzResource = { type: "event", id: "event-shared-id", eventId: "event-shared-id", tenantId: TENANT_A };
    const resourceInTenantB: AuthzResource = { type: "event", id: "event-shared-id", eventId: "event-shared-id", tenantId: TENANT_B };

    const allowedSameTenant = await canUserPerform(admin, "event:update", resourceInTenantA, store);
    assert(allowedSameTenant.allow, "grant in tenant A matches a resource in tenant A");

    const deniedCrossTenant = await canUserPerform(admin, "event:update", resourceInTenantB, store);
    assert(
      !deniedCrossTenant.allow && deniedCrossTenant.reason === "tenant_mismatch",
      "SAME event_admin grant does NOT match an identically-shaped resource in tenant B -- reason is specifically 'tenant_mismatch', not generic 'scope_mismatch'",
    );
  }

  console.log("\n== platform-wide grant (tenantId=null) matches any tenant ==");
  {
    const store = new InMemoryAuthzStore();
    const platformAdmin: HumanActor = { kind: "user", userId: "u6" };
    store.setAssignments("u6", [{ role: "system_admin", scopeType: "global", scopeId: null, tenantId: null }]);

    const resourceInA: AuthzResource = { type: "event", id: "e1", eventId: "e1", tenantId: TENANT_A };
    const resourceInB: AuthzResource = { type: "event", id: "e2", eventId: "e2", tenantId: TENANT_B };

    const allowsA = await canUserPerform(platformAdmin, "event:update", resourceInA, store);
    const allowsB = await canUserPerform(platformAdmin, "event:update", resourceInB, store);
    assert(allowsA.allow && allowsB.allow, "a platform-wide (tenantId=null) global grant matches resources in BOTH tenants");
  }

  console.log("\n== tenant-scoped global grant creating a brand-new resource (resource=null) ==");
  {
    const store = new InMemoryAuthzStore();
    const tenantAdmin: HumanActor = { kind: "user", userId: "u7" };
    store.setAssignments("u7", [{ role: "system_admin", scopeType: "global", scopeId: null, tenantId: TENANT_A }]);

    const canCreate = await canUserPerform(tenantAdmin, "event:create", null, store);
    assert(canCreate.allow, "a TENANT-scoped global grant can still event:create when there's no resource yet to check tenant against");
  }

  console.log("\n== FAIL-CLOSED: tenant-scoped grant vs. a resource with unresolved tenantId ==");
  {
    const store = new InMemoryAuthzStore();
    const admin: HumanActor = { kind: "user", userId: "u8" };
    store.setAssignments("u8", [{ role: "event_admin", scopeType: "event", scopeId: "event-A", tenantId: TENANT_A }]);

    // Simulates a resolver bug: tenantId simply never got populated.
    const resourceMissingTenant: AuthzResource = { type: "event", id: "event-A", eventId: "event-A" };
    const decision = await canUserPerform(admin, "event:update", resourceMissingTenant, store);
    assert(!decision.allow, "a tenant-scoped grant must NOT match a resource whose tenantId is undefined -- fails closed, not open");
  }

  console.log("\n== state-guarded permission (submission:update denied once approved) ==");
  {
    const store = new InMemoryAuthzStore();
    const presenter: HumanActor = { kind: "user", userId: "u9" };
    store.setAssignments("u9", [{ role: "presenter", scopeType: "own", scopeId: null, tenantId: TENANT_A }]);

    const pendingSubmission: AuthzResource = { type: "submission", id: "s1", eventId: "event-A", ownerId: "u9", status: "pending", tenantId: TENANT_A };
    const approvedSubmission: AuthzResource = { type: "submission", id: "s1", eventId: "event-A", ownerId: "u9", status: "approved", tenantId: TENANT_A };

    const canUpdatePending = await canUserPerform(presenter, "submission:update", pendingSubmission, store);
    assert(canUpdatePending.allow, "presenter can update their own pending submission");

    const cannotUpdateApproved = await canUserPerform(presenter, "submission:update", approvedSubmission, store);
    assert(
      !cannotUpdateApproved.allow && cannotUpdateApproved.reason === "state_guard_approved",
      "presenter cannot update their own submission once approved (state_guard_approved)",
    );

    // Global-scope grant is exempt from the state guard.
    const globalAdmin: HumanActor = { kind: "user", userId: "u9b" };
    store.setAssignments("u9b", [{ role: "system_admin", scopeType: "global", scopeId: null, tenantId: null }]);
    const adminCanStillUpdate = await canUserPerform(globalAdmin, "submission:update", approvedSubmission, store);
    assert(adminCanStillUpdate.allow, "a global-scope grant is exempt from the approved-state guard");
  }

  console.log("\n== staff:assign target role restriction ==");
  {
    const store = new InMemoryAuthzStore();
    const eventAdmin: HumanActor = { kind: "user", userId: "u10" };
    store.setAssignments("u10", [{ role: "event_admin", scopeType: "event", scopeId: "event-A", tenantId: TENANT_A }]);

    const assignReviewer: AuthzResource = { type: "assignment", id: "a1", eventId: "event-A", targetRole: "reviewer", tenantId: TENANT_A };
    const assignEventAdmin: AuthzResource = { type: "assignment", id: "a2", eventId: "event-A", targetRole: "event_admin", tenantId: TENANT_A };

    const canAssignReviewer = await canUserPerform(eventAdmin, "staff:assign", assignReviewer, store);
    assert(canAssignReviewer.allow, "event_admin can staff:assign a reviewer");

    const cannotAssignEventAdmin = await canUserPerform(eventAdmin, "staff:assign", assignEventAdmin, store);
    assert(
      !cannotAssignEventAdmin.allow && cannotAssignEventAdmin.reason === "staff_assign_target_role_forbidden",
      "event_admin cannot staff:assign another event_admin (not in ASSIGNABLE_BY_EVENT_ADMIN)",
    );
  }

  console.log("\n== service principals ==");
  {
    const store = new InMemoryAuthzStore();
    const conversionWorker: ServiceActor = { kind: "service", serviceId: "conversion-worker" };
    const podiumApp: ServiceActor = { kind: "service", serviceId: "podium-app" };

    const canReadRaw = await canUserPerform(conversionWorker, "submission:read_raw", null, store);
    assert(canReadRaw.allow, "conversion-worker has submission:read_raw");

    const cannotPodiumReadRaw = await canUserPerform(podiumApp, "submission:read_raw", null, store);
    assert(!cannotPodiumReadRaw.allow, "podium-app does NOT have submission:read_raw");

    console.log("\n  -- podium-app's submission:read_approved co-authorization --");
    const sessionResource: AuthzResource = { type: "submission", id: "s1", sessionId: "session-X", eventId: "event-A", tenantId: TENANT_A };

    const noOperator = await canUserPerform(
      { kind: "service", serviceId: "podium-app", onBehalfOfSessionId: "session-X" },
      "submission:read_approved",
      sessionResource,
      store,
    );
    assert(!noOperator.allow && noOperator.reason === "no_active_operator_for_session", "podium-app denied without an active operator on that session");

    store.setOperatorForLiveSession("session-X", true);
    const withOperator = await canUserPerform(
      { kind: "service", serviceId: "podium-app", onBehalfOfSessionId: "session-X" },
      "submission:read_approved",
      sessionResource,
      store,
    );
    assert(withOperator.allow, "podium-app allowed once an active operator exists for that exact session");

    const wrongSession = await canUserPerform(
      { kind: "service", serviceId: "podium-app", onBehalfOfSessionId: "session-Y" },
      "submission:read_approved",
      sessionResource,
      store,
    );
    assert(!wrongSession.allow && wrongSession.reason === "service_session_mismatch", "podium-app's onBehalfOfSessionId must match the resource's session exactly");
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("VERIFICATION SCRIPT CRASHED:", err);
  process.exit(1);
});
