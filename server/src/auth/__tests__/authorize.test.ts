import type { Request, Response } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthzDeniedError, authorizeAndPresign, authorizeMutationAndRun, canUserPerform, requirePermission } from "../authorize.js";
import { PRESIGNED_URL_TTL_SECONDS } from "../presign-policy.js";
import type { AuthzResource, HumanActor } from "../types.js";
import { InMemoryAuthzStore } from "../../testing/in-memory-authz-store.js";

/**
 * Store-dependent decision logic (ownership, event/session scoping, unknown
 * permissions, state guard, staff:assign restriction, service co-auth,
 * revocation, the exhaustive per-permission matrix) now lives in the shared
 * AuthzStoreHarness contract suite (src/testing/authz-contract-suite.ts),
 * run against both the in-memory fake and real Postgres -- see
 * src/testing/__tests__/authz-contract.*.test.ts. What's left here is
 * everything that is legitimately specific to this fake, or to
 * store-agnostic code (Express middleware wiring, the presign TTL wrapper):
 * neither needs, nor can meaningfully use, a second store implementation.
 */

function human(userId: string): HumanActor {
  return { kind: "user", userId };
}

let store: InMemoryAuthzStore;

beforeEach(() => {
  store = new InMemoryAuthzStore();
});

describe("requirePermission: absent actor", () => {
  function mockRes() {
    const state: { statusCode?: number; body?: unknown } = {};
    const res = {
      status(code: number) {
        state.statusCode = code;
        return res;
      },
      json(body: unknown) {
        state.body = body;
        return res;
      },
    };
    return { state, res: res as unknown as Response };
  }

  it("denies with 401 and audits when req.actor is absent (covers both 'no token' and 'expired token', which are indistinguishable here -- see ADR 0001)", async () => {
    const { state, res } = mockRes();
    let nextCalled = false;

    const middleware = requirePermission("submission:read", () => null, store);
    await middleware({} as unknown as Request, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
    expect(store.auditLog.at(-1)).toMatchObject({ actorId: "anonymous", decision: "deny", reason: "unauthenticated" });
  });
});

describe("presigned URL issuance (authorizeAndPresign)", () => {
  it("mints with exactly PRESIGNED_URL_TTL_SECONDS regardless of what the caller asks for", async () => {
    store.seedAssignment("presenter-a", "presenter", "own", null);
    const resource: AuthzResource = { type: "submission", id: "sub-1", ownerId: "presenter-a", status: "pending" };

    const requestedTtls: number[] = [];
    const url = await authorizeAndPresign(human("presenter-a"), "submission:download", resource, store, async (ttlSeconds) => {
      requestedTtls.push(ttlSeconds);
      return `https://example-bucket.s3.amazonaws.com/sub-1?ttl=${ttlSeconds}`;
    });

    expect(requestedTtls).toEqual([PRESIGNED_URL_TTL_SECONDS]);
    expect(PRESIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(300);
    expect(url).toContain(String(PRESIGNED_URL_TTL_SECONDS));
  });

  it("never calls mintUrl when the check denies", async () => {
    const resource: AuthzResource = { type: "submission", id: "sub-1", ownerId: "someone-else", status: "pending" };
    let minted = false;

    await expect(
      authorizeAndPresign(human("presenter-a"), "submission:download", resource, store, async () => {
        minted = true;
        return "unreachable";
      }),
    ).rejects.toBeInstanceOf(AuthzDeniedError);

    expect(minted).toBe(false);
  });
});

describe("audit write failure", () => {
  it("canUserPerform still returns the decision (allow) when the audit write fails", async () => {
    store.seedAssignment("presenter-a", "presenter", "own", null);
    store.simulateAuditWriteFailures(true);

    const resource: AuthzResource = { type: "submission", id: "sub-1", ownerId: "presenter-a", status: "pending" };
    const decision = await canUserPerform(human("presenter-a"), "submission:read", resource, store);

    expect(decision.allow).toBe(true);
    expect(store.auditLog).toHaveLength(0); // the write failed, but that never surfaced to the caller
  });

  it("canUserPerform still returns the decision (deny) when the audit write fails", async () => {
    store.simulateAuditWriteFailures(true);

    const decision = await canUserPerform(human("nobody"), "submission:read", null, store);

    expect(decision.allow).toBe(false);
    expect(store.auditLog).toHaveLength(0);
  });

  it("requirePermission still responds instead of hanging when the audit write fails on an unauthenticated request", async () => {
    store.simulateAuditWriteFailures(true);

    const state: { statusCode?: number } = {};
    const res = {
      status(code: number) {
        state.statusCode = code;
        return res;
      },
      json() {
        return res;
      },
    } as unknown as Response;

    const middleware = requirePermission("submission:read", () => null, store);
    await middleware({} as unknown as Request, res, () => undefined);

    expect(state.statusCode).toBe(401);
  });

  it("authorizeMutationAndRun rolls back the mutation when the audit write fails (fail closed, atomically)", async () => {
    store.seedAssignment("presenter-a", "presenter", "own", null);
    store.simulateAuditWriteFailures(true);

    const resource: AuthzResource = { type: "submission", id: "sub-1", ownerId: "presenter-a", status: "pending" };
    let mutated = false;

    await expect(
      authorizeMutationAndRun(human("presenter-a"), "submission:update", resource, store, async () => {
        mutated = true;
      }),
    ).rejects.toThrow("simulated audit_log insert failure");

    expect(mutated).toBe(false);
  });

  it("authorizeMutationAndRun rolls back the audit row when the mutation itself throws", async () => {
    store.seedAssignment("presenter-a", "presenter", "own", null);
    const resource: AuthzResource = { type: "submission", id: "sub-1", ownerId: "presenter-a", status: "pending" };

    await expect(
      authorizeMutationAndRun(human("presenter-a"), "submission:update", resource, store, async () => {
        throw new Error("downstream write failed");
      }),
    ).rejects.toThrow("downstream write failed");

    expect(store.auditLog).toHaveLength(0);
  });

  it("authorizeMutationAndRun commits the audit row and the mutation together on success", async () => {
    store.seedAssignment("presenter-a", "presenter", "own", null);
    const resource: AuthzResource = { type: "submission", id: "sub-1", ownerId: "presenter-a", status: "pending" };
    let mutated = false;

    const result = await authorizeMutationAndRun(human("presenter-a"), "submission:update", resource, store, async () => {
      mutated = true;
      return "ok";
    });

    expect(result).toBe("ok");
    expect(mutated).toBe(true);
    expect(store.auditLog).toHaveLength(1);
    expect(store.auditLog[0]).toMatchObject({ decision: "allow" });
  });

  it("authorizeMutationAndRun still denies (fire-and-forget audit) without needing a transaction when the permission check fails", async () => {
    const resource: AuthzResource = { type: "submission", id: "sub-1", ownerId: "someone-else", status: "pending" };
    let mutated = false;

    await expect(
      authorizeMutationAndRun(human("presenter-a"), "submission:update", resource, store, async () => {
        mutated = true;
      }),
    ).rejects.toBeInstanceOf(AuthzDeniedError);

    expect(mutated).toBe(false);
    expect(store.auditLog).toHaveLength(1);
    expect(store.auditLog[0]).toMatchObject({ decision: "deny" });
  });
});
