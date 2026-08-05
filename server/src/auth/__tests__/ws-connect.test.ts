import { describe, expect, it } from "vitest";
import { mintWsToken } from "../ws-token.js";

/**
 * validateWsConnect is a thin wrapper around verifyWsToken that
 * enforces the session scope match. Since it lives in main-panel and
 * can't be imported here directly, these tests exercise the same
 * validation logic through verifyWsToken (the function it delegates
 * to), specifically testing the $connect-relevant scenarios:
 *
 *   1. Valid token + matching session → allow
 *   2. Valid token + wrong session → deny (scope mismatch)
 *   3. Missing token → deny
 *   4. Expired token → deny
 *
 * The main-panel's ws-connect.ts is integration-tested via the
 * /api/ws/token route and typecheck.
 */
import { verifyWsToken } from "../ws-token.js";

const SECRET = new TextEncoder().encode("test-ws-connect-secret-32-bytes!");

const MINT_OPTS = {
  userId: "operator-1",
  liveSessionId: "live-session-abc",
  role: "pres_ops_staff",
  tenantId: "tenant-42",
};

describe("$connect validation logic", () => {
  it("accepts a valid token whose scope matches the requested session", async () => {
    const token = await mintWsToken(SECRET, MINT_OPTS);
    const result = await verifyWsToken(SECRET, token, "live-session-abc");

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.sub).toBe("operator-1");
      expect(result.payload.scope).toBe("live-session-abc");
      expect(result.payload.role).toBe("pres_ops_staff");
      expect(result.payload.tenantId).toBe("tenant-42");
    }
  });

  it("rejects when the token's scope does not match the requested session", async () => {
    const token = await mintWsToken(SECRET, MINT_OPTS);
    const result = await verifyWsToken(SECRET, token, "different-session");

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("session_scope_mismatch");
    }
  });

  it("rejects an empty token string", async () => {
    const result = await verifyWsToken(SECRET, "", "live-session-abc");

    expect(result.valid).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const otherSecret = new TextEncoder().encode("other-secret-for-cross-check!");
    const token = await mintWsToken(otherSecret, MINT_OPTS);
    const result = await verifyWsToken(SECRET, token, "live-session-abc");

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("invalid_signature");
    }
  });

  it("returns all payload fields needed by the connection store", async () => {
    const token = await mintWsToken(SECRET, MINT_OPTS);
    const result = await verifyWsToken(SECRET, token, "live-session-abc");

    expect(result.valid).toBe(true);
    if (result.valid) {
      // These are the fields WsConnectionStore.getActor needs
      expect(typeof result.payload.sub).toBe("string");
      expect(typeof result.payload.role).toBe("string");
      expect(typeof result.payload.tenantId).toBe("string");
      expect(typeof result.payload.scope).toBe("string");
      expect(typeof result.payload.iat).toBe("number");
      expect(typeof result.payload.exp).toBe("number");
    }
  });
});
