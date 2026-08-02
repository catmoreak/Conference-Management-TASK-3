import { beforeEach, describe, expect, it } from "vitest";
import { canUserPerform } from "../auth/authorize.js";
import { PERMISSIONS, ROLE_PERMISSIONS, SERVICE_PERMISSIONS } from "../auth/permissions.js";
import type { Actor, AuthzResource, HumanActor, Role, ServiceId } from "../auth/types.js";
import type { AuthzStoreHarness } from "./authz-store-harness.js";

const EVENT_A = "11111111-1111-1111-1111-111111111111";
const EVENT_B = "22222222-2222-2222-2222-222222222222";
const SESSION_A = "33333333-3333-3333-3333-333333333333";
const SESSION_B = "44444444-4444-4444-4444-444444444444";

const ALL_ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];
const ALL_SERVICE_IDS = Object.keys(SERVICE_PERMISSIONS) as ServiceId[];

function human(userId: string): HumanActor {
  return { kind: "user", userId };
}

function service(serviceId: ServiceId, onBehalfOfSessionId?: string): Actor {
  return onBehalfOfSessionId === undefined ? { kind: "service", serviceId } : { kind: "service", serviceId, onBehalfOfSessionId };
}

function maximalResource(ownerId: string): AuthzResource {
  return {
    type: "probe",
    id: "probe-1",
    eventId: EVENT_A,
    sessionId: SESSION_A,
    ownerId,
    status: "pending",
    targetRole: "reviewer",
  };
}

/**
 * Every assertion in here is expected to hold identically for any
 * AuthzStore implementation -- it exercises canUserPerform's decision
 * logic plus "does this store correctly report which assignments are
 * currently active" (scope, expiry, revocation). Deliberately NOT included
 * here: anything that depends on a store-specific fault-injection
 * mechanism (InMemoryAuthzStore.simulateAuditWriteFailures has no Postgres
 * equivalent -- a JS throw isn't a thing you can inject into a real INSERT)
 * or Express-middleware wiring (store-agnostic, tested once, not a store
 * contract question). Real-Postgres-only atomicity proof (constraint
 * violations forcing a genuine ROLLBACK) lives separately in
 * pg-authz-store.postgres.test.ts, because the in-memory fake's "rollback"
 * is a JS array buffer, not a real transaction, and cannot stand in for
 * that proof.
 *
 * Time margins here are deliberately generous (minutes, not the ~1s some
 * earlier fake-only tests used) -- against real Postgres this suite pays a
 * network round trip per query, and a razor-thin margin that's safe when
 * the comparison happens synchronously in-process is a flake risk once a
 * real clock and a real hop are involved.
 */
export function defineAuthzContractSuite(label: string, getHarness: () => AuthzStoreHarness): void {
  describe(`AuthzStore contract -- ${label}`, () => {
    let harness: AuthzStoreHarness;

    beforeEach(async () => {
      harness = getHarness();
      await harness.reset();
    });

    describe("ownership ('own' scope)", () => {
      it("denies a presenter reading another presenter's submission", async () => {
        await harness.seedAssignment("presenter-a", "presenter", "own", null);
        await harness.seedAssignment("presenter-b", "presenter", "own", null);

        const othersSubmission: AuthzResource = { type: "submission", id: "sub-1", eventId: EVENT_A, ownerId: "presenter-b", status: "pending" };
        const decision = await canUserPerform(human("presenter-a"), "submission:read", othersSubmission, harness.store);

        expect(decision).toEqual({ allow: false, reason: "scope_mismatch" });
      });

      it("allows a presenter to read their own submission", async () => {
        await harness.seedAssignment("presenter-a", "presenter", "own", null);

        const own: AuthzResource = { type: "submission", id: "sub-1", eventId: EVENT_A, ownerId: "presenter-a", status: "pending" };
        const decision = await canUserPerform(human("presenter-a"), "submission:read", own, harness.store);

        expect(decision.allow).toBe(true);
      });

      it("ignores scopeId on an 'own' assignment -- matching is by resource.ownerId only", async () => {
        await harness.seedAssignment("presenter-a", "presenter", "own", null);

        const someoneElses: AuthzResource = { type: "submission", id: "sub-1", eventId: EVENT_A, ownerId: "presenter-b", status: "pending" };
        const decision = await canUserPerform(human("presenter-a"), "submission:read", someoneElses, harness.store);

        expect(decision).toEqual({ allow: false, reason: "scope_mismatch" });
      });

      it("denies an 'own'-scoped check against a null resource instead of matching", async () => {
        await harness.seedAssignment("presenter-a", "presenter", "own", null);

        const decision = await canUserPerform(human("presenter-a"), "submission:read", null, harness.store);

        expect(decision).toEqual({ allow: false, reason: "scope_mismatch" });
      });
    });

    describe("event / session scoping", () => {
      it("denies a reviewer approving a submission outside their assigned event", async () => {
        await harness.seedAssignment("reviewer-1", "reviewer", "event", EVENT_A);

        const outsideEvent: AuthzResource = { type: "submission", id: "sub-2", eventId: EVENT_B, ownerId: "presenter-x", status: "pending" };
        const decision = await canUserPerform(human("reviewer-1"), "submission:approve", outsideEvent, harness.store);

        expect(decision).toEqual({ allow: false, reason: "scope_mismatch" });
      });

      it("denies an operator sending playback:control for a session they don't own", async () => {
        await harness.seedAssignment("operator-1", "operator", "session", SESSION_A);

        const otherSession: AuthzResource = { type: "session", id: SESSION_B, sessionId: SESSION_B };
        const decision = await canUserPerform(human("operator-1"), "playback:control", otherSession, harness.store);

        expect(decision).toEqual({ allow: false, reason: "scope_mismatch" });
      });

      it("does not let an event_admin's event-scoped grant cascade into playback:control", async () => {
        await harness.seedAssignment("admin-1", "event_admin", "event", EVENT_A);

        const sessionInTheirEvent: AuthzResource = { type: "session", id: SESSION_A, sessionId: SESSION_A };
        const decision = await canUserPerform(human("admin-1"), "playback:control", sessionInTheirEvent, harness.store);

        expect(decision.allow).toBe(false);
      });
    });

    describe("unknown permission string", () => {
      it("denies and audits without consulting role grants", async () => {
        await harness.seedAssignment("system-1", "system_admin", "global", null);

        const decision = await canUserPerform(human("system-1"), "submission:hack", null, harness.store);
        expect(decision).toEqual({ allow: false, reason: "unknown_permission" });

        const log = await harness.getAuditLog();
        expect(log.at(-1)).toMatchObject({ decision: "deny", reason: "unknown_permission" });
      });
    });

    describe("expiry", () => {
      it("denies an expired session-scoped grant the same as no grant at all", async () => {
        const expiredAt = new Date(Date.now() - 1000 * 60 * 5);
        await harness.seedAssignment("presenter-clicker", "operator", "session", SESSION_A, expiredAt);

        const resource: AuthzResource = { type: "session", id: SESSION_A, sessionId: SESSION_A };
        const decision = await canUserPerform(human("presenter-clicker"), "playback:control", resource, harness.store);

        expect(decision).toEqual({ allow: false, reason: "no_role_grant" });
      });

      it("allows playback:control on a presenter's time-boxed self-playback grant while it hasn't expired", async () => {
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60);
        await harness.seedAssignment("presenter-clicker", "operator", "session", SESSION_A, expiresAt);

        const resource: AuthzResource = { type: "session", id: SESSION_A, sessionId: SESSION_A };
        const decision = await canUserPerform(human("presenter-clicker"), "playback:control", resource, harness.store);

        expect(decision.allow).toBe(true);
      });
    });

    describe("state guard on submission:update / submission:delete", () => {
      it("denies submission:update once status is approved, for a non-global grant", async () => {
        await harness.seedAssignment("presenter-a", "presenter", "own", null);

        const approved: AuthzResource = { type: "submission", id: "sub-1", eventId: EVENT_A, ownerId: "presenter-a", status: "approved" };
        const decision = await canUserPerform(human("presenter-a"), "submission:update", approved, harness.store);

        expect(decision).toEqual({ allow: false, reason: "state_guard_approved" });
      });

      it("denies submission:delete once status is approved", async () => {
        await harness.seedAssignment("presenter-a", "presenter", "own", null);

        const approved: AuthzResource = { type: "submission", id: "sub-1", eventId: EVENT_A, ownerId: "presenter-a", status: "approved" };
        const decision = await canUserPerform(human("presenter-a"), "submission:delete", approved, harness.store);

        expect(decision).toEqual({ allow: false, reason: "state_guard_approved" });
      });

      it("allows submission:create (re-upload / new version) even once status is approved", async () => {
        await harness.seedAssignment("presenter-a", "presenter", "own", null);

        const approved: AuthzResource = { type: "submission", id: "sub-1", eventId: EVENT_A, ownerId: "presenter-a", status: "approved" };
        const decision = await canUserPerform(human("presenter-a"), "submission:create", approved, harness.store);

        expect(decision.allow).toBe(true);
      });

      it("lets system_admin's global grant bypass the state guard", async () => {
        await harness.seedAssignment("system-1", "system_admin", "global", null);

        const approved: AuthzResource = { type: "submission", id: "sub-1", eventId: EVENT_A, ownerId: "presenter-a", status: "approved" };
        const decision = await canUserPerform(human("system-1"), "submission:update", approved, harness.store);

        expect(decision.allow).toBe(true);
      });
    });

    describe("staff:assign target-role restriction", () => {
      it("lets an event_admin assign a reviewer within their event", async () => {
        await harness.seedAssignment("admin-1", "event_admin", "event", EVENT_A);

        const resource: AuthzResource = { type: "staff_assignment", id: "n/a", eventId: EVENT_A, targetRole: "reviewer" };
        const decision = await canUserPerform(human("admin-1"), "staff:assign", resource, harness.store);

        expect(decision.allow).toBe(true);
      });

      it("denies an event_admin assigning another event_admin", async () => {
        await harness.seedAssignment("admin-1", "event_admin", "event", EVENT_A);

        const resource: AuthzResource = { type: "staff_assignment", id: "n/a", eventId: EVENT_A, targetRole: "event_admin" };
        const decision = await canUserPerform(human("admin-1"), "staff:assign", resource, harness.store);

        expect(decision).toEqual({ allow: false, reason: "staff_assign_target_role_forbidden" });
      });

      it("lets system_admin assign event_admin itself", async () => {
        await harness.seedAssignment("system-1", "system_admin", "global", null);

        const resource: AuthzResource = { type: "staff_assignment", id: "n/a", eventId: EVENT_A, targetRole: "event_admin" };
        const decision = await canUserPerform(human("system-1"), "staff:assign", resource, harness.store);

        expect(decision.allow).toBe(true);
      });
    });

    describe("service principals", () => {
      it("lets the malware scanner read raw files", async () => {
        const decision = await canUserPerform(service("malware-scanner"), "submission:read_raw", { type: "submission", id: "sub-1" }, harness.store);
        expect(decision.allow).toBe(true);
      });

      it("never resolves a service credential to system_admin-level permissions", async () => {
        const decision = await canUserPerform(service("malware-scanner"), "event:create", null, harness.store);
        expect(decision).toEqual({ allow: false, reason: "service_permission_not_granted" });
      });

      it("denies the malware scanner writing derived output (not its permission)", async () => {
        const decision = await canUserPerform(service("malware-scanner"), "submission:write_derived", { type: "submission", id: "sub-1" }, harness.store);
        expect(decision).toEqual({ allow: false, reason: "service_permission_not_granted" });
      });

      it("lets podium-app read an approved submission when an operator is actively assigned to that session", async () => {
        await harness.seedAssignment("operator-1", "operator", "session", SESSION_A);

        const decision = await canUserPerform(
          service("podium-app", SESSION_A),
          "submission:read_approved",
          { type: "submission", id: "sub-1", sessionId: SESSION_A, status: "approved" },
          harness.store,
        );

        expect(decision.allow).toBe(true);
      });

      it("denies podium-app when no operator is actively assigned to that session", async () => {
        const decision = await canUserPerform(
          service("podium-app", SESSION_A),
          "submission:read_approved",
          { type: "submission", id: "sub-1", sessionId: SESSION_A, status: "approved" },
          harness.store,
        );

        expect(decision).toEqual({ allow: false, reason: "no_active_operator_for_session" });
      });

      it("denies podium-app fetching for a session other than the one it's currently serving", async () => {
        await harness.seedAssignment("operator-1", "operator", "session", SESSION_A);

        const decision = await canUserPerform(
          service("podium-app", SESSION_B),
          "submission:read_approved",
          { type: "submission", id: "sub-1", sessionId: SESSION_A, status: "approved" },
          harness.store,
        );

        expect(decision).toEqual({ allow: false, reason: "service_session_mismatch" });
      });

      it("an expired operator assignment cuts off podium-app access the same as no assignment", async () => {
        await harness.seedAssignment("operator-1", "operator", "session", SESSION_A, new Date(Date.now() - 1000 * 60 * 5));

        const decision = await canUserPerform(
          service("podium-app", SESSION_A),
          "submission:read_approved",
          { type: "submission", id: "sub-1", sessionId: SESSION_A, status: "approved" },
          harness.store,
        );

        expect(decision).toEqual({ allow: false, reason: "no_active_operator_for_session" });
      });

      it("explicitly revoking the operator assignment cuts off podium-app access mid-session", async () => {
        const handle = await harness.seedAssignment("operator-1", "operator", "session", SESSION_A);
        const resource: AuthzResource = { type: "submission", id: "sub-1", sessionId: SESSION_A, status: "approved" };

        const before = await canUserPerform(service("podium-app", SESSION_A), "submission:read_approved", resource, harness.store);
        expect(before.allow).toBe(true);

        await harness.revoke(handle);

        const after = await canUserPerform(service("podium-app", SESSION_A), "submission:read_approved", resource, harness.store);
        expect(after).toEqual({ allow: false, reason: "no_active_operator_for_session" });
      });
    });

    describe("revocation", () => {
      it("denies immediately once an assignment is revoked mid-session", async () => {
        const handle = await harness.seedAssignment("operator-1", "operator", "session", SESSION_A);
        const resource: AuthzResource = { type: "session", id: SESSION_A, sessionId: SESSION_A };

        const before = await canUserPerform(human("operator-1"), "playback:control", resource, harness.store);
        expect(before.allow).toBe(true);

        await harness.revoke(handle);

        const after = await canUserPerform(human("operator-1"), "playback:control", resource, harness.store);
        expect(after).toEqual({ allow: false, reason: "no_role_grant" });
      });

      it("does not leak a revoked row into a match via any of its fields", async () => {
        const handle = await harness.seedAssignment("reviewer-1", "reviewer", "event", EVENT_A);
        await harness.revoke(handle);

        const resource: AuthzResource = { type: "submission", id: "sub-1", eventId: EVENT_A, status: "pending" };
        const decision = await canUserPerform(human("reviewer-1"), "submission:approve", resource, harness.store);

        expect(decision).toEqual({ allow: false, reason: "no_role_grant" });
      });
    });

    describe("audit log", () => {
      it("records both allows and denials", async () => {
        await harness.seedAssignment("presenter-a", "presenter", "own", null);

        await canUserPerform(human("presenter-a"), "submission:read", { type: "submission", id: "s1", ownerId: "presenter-a" }, harness.store);
        await canUserPerform(human("presenter-a"), "submission:read", { type: "submission", id: "s2", ownerId: "someone-else" }, harness.store);

        const log = await harness.getAuditLog();
        expect(log).toHaveLength(2);
        expect(log[0]).toMatchObject({ decision: "allow" });
        expect(log[1]).toMatchObject({ decision: "deny", reason: "scope_mismatch" });
      });
    });

    describe("exhaustive deny matrix: human roles", () => {
      for (const role of ALL_ROLES) {
        const granted = new Set<string>(ROLE_PERMISSIONS[role]);
        for (const permission of PERMISSIONS) {
          if (granted.has(permission)) continue;

          it(`${role} is denied ${permission}`, async () => {
            const userId = `probe-${role}`;
            await harness.seedAssignment(userId, role, "global", null);

            const decision = await canUserPerform({ kind: "user", userId }, permission, maximalResource(userId), harness.store);

            expect(decision).toEqual({ allow: false, reason: "no_role_grant" });
          });
        }
      }
    });

    describe("exhaustive deny matrix: service principals", () => {
      for (const serviceId of ALL_SERVICE_IDS) {
        const granted = new Set<string>(SERVICE_PERMISSIONS[serviceId]);
        for (const permission of PERMISSIONS) {
          if (granted.has(permission)) continue;

          it(`${serviceId} is denied ${permission}`, async () => {
            const decision = await canUserPerform(service(serviceId, SESSION_A), permission, maximalResource("someone-else"), harness.store);

            expect(decision).toEqual({ allow: false, reason: "service_permission_not_granted" });
          });
        }
      }
    });
  });
}
