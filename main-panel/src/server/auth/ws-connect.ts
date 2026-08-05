/**
 * WebSocket $connect validator.
 *
 * Framework-agnostic function that validates an incoming WebSocket
 * connection request by verifying the short-lived JWT issued by
 * POST /api/ws/token. Can be called from an API Gateway Lambda
 * authorizer, a standalone WS server, or a test harness.
 *
 * This is purely validation — no HTTP dependency, no database access.
 * The JWT itself carries enough information (userId, role, tenantId,
 * session scope) for the connection store to bind an identity.
 */

import {
  verifyWsToken,
  type WsTokenPayload,
} from "~/server/auth/ws-token";

export interface WsConnectSuccess {
  valid: true;
  payload: WsTokenPayload;
}

export interface WsConnectFailure {
  valid: false;
  reason: string;
}

export type WsConnectResult = WsConnectSuccess | WsConnectFailure;

/**
 * Validate a WebSocket $connect handshake.
 *
 * @param params.token         - The JWT from the query string or
 *   Authorization header of the $connect request.
 * @param params.liveSessionId - The Live Session ID the client is
 *   attempting to connect to (from the URL path or query string).
 *
 * Checks performed:
 *   1. JWT signature (HS256, WS_JWT_SECRET)
 *   2. Expiry (jose's built-in exp check)
 *   3. Audience === "ws:connect"
 *   4. scope claim === liveSessionId
 */
export async function validateWsConnect(params: {
  token: string;
  liveSessionId: string;
}): Promise<WsConnectResult> {
  if (!params.token) {
    return { valid: false, reason: "missing_token" };
  }
  if (!params.liveSessionId) {
    return { valid: false, reason: "missing_session_id" };
  }

  return verifyWsToken(params.token, params.liveSessionId);
}
