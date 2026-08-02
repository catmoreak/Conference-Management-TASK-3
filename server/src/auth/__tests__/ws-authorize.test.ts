import { beforeEach, describe, expect, it } from "vitest";
import { authorizeWsMessage, playbackMessageResolver } from "../ws-authorize.js";
import type { WsConnectionStore } from "../ws-authorize.js";
import type { Actor } from "../types.js";
import { InMemoryAuthzStore } from "../../testing/in-memory-authz-store.js";

const SESSION_A = "33333333-3333-3333-3333-333333333333";
const SESSION_B = "44444444-4444-4444-4444-444444444444";

class MapConnectionStore implements WsConnectionStore {
  private readonly byConnection = new Map<string, Actor>();

  set(connectionId: string, actor: Actor): void {
    this.byConnection.set(connectionId, actor);
  }

  async getActor(connectionId: string): Promise<Actor | null> {
    return this.byConnection.get(connectionId) ?? null;
  }
}

let store: InMemoryAuthzStore;
let connections: MapConnectionStore;

beforeEach(() => {
  store = new InMemoryAuthzStore();
  connections = new MapConnectionStore();
});

describe("authorizeWsMessage", () => {
  it("denies a message on a connection with no bound identity", async () => {
    const decision = await authorizeWsMessage(
      "conn-1",
      { type: "playback:next", payload: { sessionId: SESSION_A } },
      playbackMessageResolver,
      connections,
      store,
    );

    expect(decision).toEqual({ allow: false, reason: "unauthenticated" });
    expect(store.auditLog.at(-1)).toMatchObject({ actorId: "anonymous", reason: "unauthenticated" });
  });

  it("denies an unrecognized message type", async () => {
    connections.set("conn-1", { kind: "user", userId: "operator-1" });

    const decision = await authorizeWsMessage(
      "conn-1",
      { type: "not:a:real:command", payload: {} },
      playbackMessageResolver,
      connections,
      store,
    );

    expect(decision).toEqual({ allow: false, reason: "unrecognized_message_type" });
  });

  it("re-checks authorization on every message, not just at connect", async () => {
    store.seedAssignment("operator-1", "operator", "session", SESSION_A);
    connections.set("conn-1", { kind: "user", userId: "operator-1" });

    const allowed = await authorizeWsMessage(
      "conn-1",
      { type: "playback:next", payload: { sessionId: SESSION_A } },
      playbackMessageResolver,
      connections,
      store,
    );
    expect(allowed.allow).toBe(true);

    // Same connection, same operator -- but this message targets a session they don't own.
    const deniedForOtherSession = await authorizeWsMessage(
      "conn-1",
      { type: "playback:next", payload: { sessionId: SESSION_B } },
      playbackMessageResolver,
      connections,
      store,
    );
    expect(deniedForOtherSession).toEqual({ allow: false, reason: "scope_mismatch" });
  });

  it("denies playback:control for a session the connected operator doesn't own", async () => {
    store.seedAssignment("operator-1", "operator", "session", SESSION_A);
    connections.set("conn-1", { kind: "user", userId: "operator-1" });

    const decision = await authorizeWsMessage(
      "conn-1",
      { type: "playback:jump", payload: { sessionId: SESSION_B } },
      playbackMessageResolver,
      connections,
      store,
    );

    expect(decision).toEqual({ allow: false, reason: "scope_mismatch" });
  });
});

describe("playback grant lifetime vs. JWT expiry", () => {
  it("keeps a presenter's self-playback grant working mid-session even though their original token would have expired by now", async () => {
    // The connection store binds identity once at $connect and is expected
    // to keep returning it regardless of the backing JWT's own exp -- see
    // the WsConnectionStore contract doc. authorizeWsMessage's signature
    // has no token parameter at all, so there is structurally no way for
    // token freshness to factor into this decision; only the grant's own
    // expires_at (below) can.
    const sessionEndsAt = new Date(Date.now() + 1000 * 60 * 30); // session still has 30 min left
    store.seedAssignment("presenter-clicker", "operator", "session", SESSION_A, sessionEndsAt);
    connections.set("conn-1", { kind: "user", userId: "presenter-clicker" });

    // Simulates a long-lived open connection well past a typical ~1h access
    // token TTL -- there is nothing in this call that could observe that.
    const decision = await authorizeWsMessage(
      "conn-1",
      { type: "playback:next", payload: { sessionId: SESSION_A } },
      playbackMessageResolver,
      connections,
      store,
    );

    expect(decision.allow).toBe(true);
  });

  it("denies once the grant's own expires_at passes, independent of the connection still being open", async () => {
    const sessionEndedAt = new Date(Date.now() - 1000 * 60); // session ended a minute ago
    store.seedAssignment("presenter-clicker", "operator", "session", SESSION_A, sessionEndedAt);
    connections.set("conn-1", { kind: "user", userId: "presenter-clicker" });

    const decision = await authorizeWsMessage(
      "conn-1",
      { type: "playback:next", payload: { sessionId: SESSION_A } },
      playbackMessageResolver,
      connections,
      store,
    );

    expect(decision).toEqual({ allow: false, reason: "no_role_grant" });
  });
});
