/**
 * WebSocket connect-token minting and verification.
 *
 * This module is the main-panel counterpart of server/src/auth/ws-token.ts.
 * It binds the signing secret from the WS_JWT_SECRET env var and re-exports
 * env-bound mint/verify functions for use by API route handlers.
 *
 * IMPORTANT: The signing key is derived from WS_JWT_SECRET, which MUST be
 * cryptographically separate from BETTER_AUTH_SECRET. Leaking one must not
 * compromise the other.
 */

import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

// ── Constants ────────────────────────────────────────────────────────────

/**
 * Audience claim for WebSocket connect tokens. REST API endpoints MUST
 * reject JWTs carrying this audience — it is the functional firewall
 * that prevents a leaked WS token from being accepted on any non-WS
 * surface.
 */
export const WS_TOKEN_AUDIENCE = "ws:connect";

/** Minimum allowed TTL (seconds). */
const WS_TOKEN_MIN_TTL = 60;

/** Maximum allowed TTL (seconds). Matches presign-policy.ts cap. */
const WS_TOKEN_MAX_TTL = 300;

/** Default TTL when the caller does not specify one. */
const WS_TOKEN_DEFAULT_TTL = 120;

// ── Types ────────────────────────────────────────────────────────────────

export interface WsTokenPayload {
  /** User ID (Better Auth user.id). */
  sub: string;
  /** Always "ws:connect" — REST endpoints must reject this. */
  aud: string;
  /** Live Session ID this token is scoped to. */
  scope: string;
  /** User's role at mint time (informational, not authoritative). */
  role: string;
  /** User's tenantId at mint time. */
  tenantId: string;
  /** Issued-at (unix seconds). */
  iat: number;
  /** Expiration (unix seconds). */
  exp: number;
}

export interface MintWsTokenOptions {
  userId: string;
  liveSessionId: string;
  role: string;
  tenantId: string;
  /** TTL in seconds. Clamped to [60, 300]. Defaults to 120. */
  ttlSeconds?: number;
}

// ── Key derivation ───────────────────────────────────────────────────────

/**
 * Lazily derived signing key. Read once, cached for the process lifetime.
 * Falls back to a dev-only default in non-production environments.
 */
let _cachedKey: Uint8Array | null = null;

function getSigningKey(): Uint8Array {
  if (_cachedKey) return _cachedKey;

  const raw = process.env.WS_JWT_SECRET;
  if (!raw && process.env.NODE_ENV === "production") {
    throw new Error(
      "WS_JWT_SECRET is required in production. " +
        "It must be a distinct secret from BETTER_AUTH_SECRET.",
    );
  }

  const secret = raw ?? "dev-only-ws-jwt-secret-NOT-FOR-PRODUCTION";
  _cachedKey = new TextEncoder().encode(secret);
  return _cachedKey;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function clampTtl(ttl: number | undefined): number {
  const raw = ttl ?? WS_TOKEN_DEFAULT_TTL;
  return Math.max(WS_TOKEN_MIN_TTL, Math.min(WS_TOKEN_MAX_TTL, raw));
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Mint a short-lived, single-purpose JWT for WebSocket $connect.
 *
 * The token is signed with WS_JWT_SECRET (never BETTER_AUTH_SECRET).
 * Its `aud` claim is always "ws:connect" so it cannot be accepted by
 * any regular REST API middleware.
 */
export async function mintWsToken(opts: MintWsTokenOptions): Promise<string> {
  const key = getSigningKey();
  const ttl = clampTtl(opts.ttlSeconds);

  return new SignJWT({
    scope: opts.liveSessionId,
    role: opts.role,
    tenantId: opts.tenantId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(opts.userId)
    .setAudience(WS_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(key);
}

/**
 * Verify a WebSocket connect JWT: signature, expiry, audience, and
 * optionally the session scope.
 *
 * @param token             - Compact JWS string from the client.
 * @param expectedSessionId - If provided, the token's `scope` claim
 *   must match exactly. Omit to skip the scope check.
 */
export async function verifyWsToken(
  token: string,
  expectedSessionId?: string,
): Promise<
  | { valid: true; payload: WsTokenPayload }
  | { valid: false; reason: string }
> {
  const key = getSigningKey();
  let payload: WsTokenPayload;

  try {
    const { payload: raw } = await jwtVerify(token, key, {
      audience: WS_TOKEN_AUDIENCE,
      algorithms: ["HS256"],
    });
    payload = {
      sub: raw.sub ?? "",
      aud:
        typeof raw.aud === "string"
          ? raw.aud
          : Array.isArray(raw.aud)
            ? (raw.aud[0] ?? "")
            : "",
      scope: (raw as Record<string, unknown>)["scope"] as string ?? "",
      role: (raw as Record<string, unknown>)["role"] as string ?? "",
      tenantId: (raw as Record<string, unknown>)["tenantId"] as string ?? "",
      iat: raw.iat ?? 0,
      exp: raw.exp ?? 0,
    };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      return { valid: false, reason: "token_expired" };
    }
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      return { valid: false, reason: "invalid_claims" };
    }
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      return { valid: false, reason: "invalid_signature" };
    }
    return { valid: false, reason: "invalid_token" };
  }

  if (!payload.sub) {
    return { valid: false, reason: "missing_subject" };
  }
  if (!payload.scope) {
    return { valid: false, reason: "missing_scope" };
  }

  if (expectedSessionId !== undefined && payload.scope !== expectedSessionId) {
    return { valid: false, reason: "session_scope_mismatch" };
  }

  return { valid: true, payload };
}
