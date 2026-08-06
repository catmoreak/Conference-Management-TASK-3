/**
 * Ported from server/src/auth/ws-authorize.ts, unchanged. Not wired to any
 * live WebSocket server yet -- podium's WebSocketClient.ts is the client
 * side of this protocol; a server-side handler that calls authorizeWsMessage
 * per inbound message still needs to be built.
 */

import { canUserPerform, recordAuditBestEffort } from "./authorize";
import type { Actor, AuthzDecision, AuthzResource, AuthzStore, Permission } from "./types";

/**
 * Identity bound to a WebSocket connection at $connect time (verified via
 * ws-token.ts's verifyWsToken for humans, or a service credential for
 * podium-app).
 *
 * Contract for real implementations: getActor must return the identity
 * established once at $connect, unchanged, until the connection is
 * explicitly torn down -- it must NOT re-verify the original JWT or evict
 * the binding based on the token's `exp` claim. Token lifetime governs
 * whether a *new* connection can be established; it must not govern
 * whether an *already-open* connection keeps working. This is what lets a
 * presenter keep driving their slides from the podium clicker across a
 * token refresh window without a visible interruption: the capability
 * itself (the session-scoped 'operator' grant, see authorize.ts) is
 * governed by its own expires_at, re-checked fresh on every message via
 * canUserPerform -- that is the per-message re-check this module performs,
 * and it is deliberately independent of the connection's token.
 */
export interface WsConnectionStore {
  getActor(connectionId: string): Promise<Actor | null>;
}

export interface WsMessage {
  type: string;
  payload: Record<string, unknown>;
}

/** Maps an inbound message to the permission + resource it requires, or null if the message type is unrecognized. */
export type WsPermissionResolver = (
  message: WsMessage,
) => { permission: Permission; resource: AuthzResource } | null;

/**
 * Applies canUserPerform per inbound message, not just at connect time.
 * Every call -- unauthenticated connection, unrecognized message type, or a
 * real permission/scope denial -- produces an audit row. All audit writes
 * here are best-effort (see recordAuditBestEffort): WebSocket messages
 * never gate a database mutation directly, so there is nothing for them to
 * be transactionally atomic with.
 */
export async function authorizeWsMessage(
  connectionId: string,
  message: WsMessage,
  resolvePermission: WsPermissionResolver,
  connections: WsConnectionStore,
  store: AuthzStore,
): Promise<AuthzDecision> {
  const actor = await connections.getActor(connectionId);
  if (!actor) {
    const decision: AuthzDecision = { allow: false, reason: "unauthenticated" };
    await recordAuditBestEffort(store, {
      actorType: "user",
      actorId: "anonymous",
      permission: message.type,
      resourceType: null,
      resourceId: null,
      decision: "deny",
      reason: decision.reason,
    });
    return decision;
  }

  const resolved = resolvePermission(message);
  if (!resolved) {
    const decision: AuthzDecision = { allow: false, reason: "unrecognized_message_type" };
    await recordAuditBestEffort(store, {
      actorType: actor.kind,
      actorId: actor.kind === "user" ? actor.userId : actor.serviceId,
      permission: message.type,
      resourceType: null,
      resourceId: null,
      decision: "deny",
      reason: decision.reason,
    });
    return decision;
  }

  return canUserPerform(actor, resolved.permission, resolved.resource, store);
}

/**
 * Example resolver for the podium playback protocol -- concrete enough to
 * exercise authorizeWsMessage in tests without building the playback
 * feature endpoints themselves. Every message must carry the sessionId it
 * targets; there is no ambient "current session" trusted from connect time.
 */
export const playbackMessageResolver: WsPermissionResolver = (message) => {
  const sessionId = message.payload["sessionId"];
  if (typeof sessionId !== "string") return null;

  const resource: AuthzResource = { type: "session", id: sessionId, sessionId };

  switch (message.type) {
    case "playback:next":
    case "playback:prev":
    case "playback:jump":
    case "playback:pause":
      return { permission: "playback:control", resource };
    case "playback:status":
      return { permission: "playback:read", resource };
    default:
      return null;
  }
};
