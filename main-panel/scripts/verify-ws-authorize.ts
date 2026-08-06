// Verifies authorizeWsMessage / playbackMessageResolver's decision logic,
// using InMemoryAuthzStore -- no live database or WebSocket server needed.
//
// Run: npx tsx scripts/verify-ws-authorize.ts
import { authorizeWsMessage, playbackMessageResolver } from "../src/server/auth/authz/ws-authorize";
import type { WsConnectionStore } from "../src/server/auth/authz/ws-authorize";
import { InMemoryAuthzStore } from "../src/server/auth/authz/in-memory-store";
import type { Actor } from "../src/server/auth/authz/types";

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

const SESSION_A = "session-A";
const SESSION_B = "session-B";

class MapConnectionStore implements WsConnectionStore {
  private readonly byConnection = new Map<string, Actor>();

  set(connectionId: string, actor: Actor): void {
    this.byConnection.set(connectionId, actor);
  }

  async getActor(connectionId: string): Promise<Actor | null> {
    return this.byConnection.get(connectionId) ?? null;
  }
}

async function main() {
  console.log("== unauthenticated connection ==");
  {
    const store = new InMemoryAuthzStore();
    const connections = new MapConnectionStore();

    const decision = await authorizeWsMessage(
      "conn-1",
      { type: "playback:next", payload: { sessionId: SESSION_A } },
      playbackMessageResolver,
      connections,
      store,
    );
    assert(!decision.allow && decision.reason === "unauthenticated", "denies a message on a connection with no bound identity");
    assert(store.auditLog.at(-1)?.actorId === "anonymous", "audits the anonymous attempt");
  }

  console.log("\n== unrecognized message type ==");
  {
    const store = new InMemoryAuthzStore();
    const connections = new MapConnectionStore();
    connections.set("conn-1", { kind: "user", userId: "operator-1" });

    const decision = await authorizeWsMessage(
      "conn-1",
      { type: "not:a:real:command", payload: {} },
      playbackMessageResolver,
      connections,
      store,
    );
    assert(!decision.allow && decision.reason === "unrecognized_message_type", "denies an unrecognized message type");
  }

  console.log("\n== re-checks authorization on every message, not just at connect ==");
  {
    const store = new InMemoryAuthzStore();
    const connections = new MapConnectionStore();
    store.setAssignments("operator-1", [{ role: "operator", scopeType: "session", scopeId: SESSION_A, tenantId: null }]);
    connections.set("conn-1", { kind: "user", userId: "operator-1" });

    const allowed = await authorizeWsMessage(
      "conn-1",
      { type: "playback:next", payload: { sessionId: SESSION_A } },
      playbackMessageResolver,
      connections,
      store,
    );
    assert(allowed.allow, "operator scoped to session-A can playback:next session-A");

    // Same connection, same operator -- but this message targets a session they don't own.
    const deniedForOtherSession = await authorizeWsMessage(
      "conn-1",
      { type: "playback:next", payload: { sessionId: SESSION_B } },
      playbackMessageResolver,
      connections,
      store,
    );
    assert(
      !deniedForOtherSession.allow && deniedForOtherSession.reason === "scope_mismatch",
      "same connection is denied playback:next on session-B (re-checked per message, not cached from connect)",
    );
  }

  console.log("\n== playback:status resolves to playback:read, not playback:control ==");
  {
    const store = new InMemoryAuthzStore();
    const connections = new MapConnectionStore();
    store.setAssignments("reader-1", [{ role: "operator", scopeType: "session", scopeId: SESSION_A, tenantId: null }]);
    connections.set("conn-1", { kind: "user", userId: "reader-1" });

    const decision = await authorizeWsMessage(
      "conn-1",
      { type: "playback:status", payload: { sessionId: SESSION_A } },
      playbackMessageResolver,
      connections,
      store,
    );
    assert(decision.allow, "operator scoped to session-A can playback:status session-A (playback:read)");
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("VERIFICATION SCRIPT CRASHED:", err);
  process.exit(1);
});
