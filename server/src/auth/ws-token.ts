import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

/**
 * Audience claim for WebSocket connect tokens. REST API endpoints MUST
 * reject JWTs carrying this audience — it is the functional firewall
 * that prevents a leaked WS token from being used as a session cookie
 * substitute on any non-WebSocket surface.
 */
export const WS_TOKEN_AUDIENCE = "ws:connect";

/** Minimum allowed TTL (seconds). */
export const WS_TOKEN_MIN_TTL = 60;

/** Maximum allowed TTL (seconds). Matches presign-policy.ts cap. */
export const WS_TOKEN_MAX_TTL = 300;

/** Default TTL when the caller does not specify one. */
export const WS_TOKEN_DEFAULT_TTL = 120;

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

/**
 * Clamp a TTL value into the [WS_TOKEN_MIN_TTL, WS_TOKEN_MAX_TTL]
 * range. Out-of-range values are silently clamped, never rejected —
 * the caller has already passed RBAC; a slightly wrong TTL is not a
 * reason to deny the token entirely.
 */
function clampTtl(ttl: number | undefined): number {
  const raw = ttl ?? WS_TOKEN_DEFAULT_TTL;
  return Math.max(WS_TOKEN_MIN_TTL, Math.min(WS_TOKEN_MAX_TTL, raw));
}

/**
 * Mint a short-lived, single-purpose JWT for WebSocket $connect.
 *
 * @param secret - HMAC-SHA256 signing key (must NOT be the Better Auth
 *   session secret — cryptographic separation is a hard requirement).
 * @param opts   - Token payload fields + optional TTL override.
 * @returns Compact JWS string.
 */
export async function mintWsToken(
  secret: Uint8Array,
  opts: MintWsTokenOptions,
): Promise<string> {
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
    .sign(secret);
}

export interface VerifyWsTokenResult {
  valid: true;
  payload: WsTokenPayload;
}

export interface VerifyWsTokenError {
  valid: false;
  reason: string;
}

/**
 * Verify a WebSocket connect JWT: signature, expiry, audience, and
 * optionally the session scope.
 *
 * @param secret            - Same HMAC key used to mint the token.
 * @param token             - Compact JWS string from the client.
 * @param expectedSessionId - If provided, the token's `scope` claim
 *   must match exactly. Omit to skip the scope check (useful when the
 *   handler doesn't yet know the session ID).
 */
export async function verifyWsToken(
  secret: Uint8Array,
  token: string,
  expectedSessionId?: string,
): Promise<VerifyWsTokenResult | VerifyWsTokenError> {
  let payload: WsTokenPayload;

  try {
    const { payload: raw } = await jwtVerify(token, secret, {
      audience: WS_TOKEN_AUDIENCE,
      algorithms: ["HS256"],
    });
    payload = {
      sub: raw.sub ?? "",
      aud: typeof raw.aud === "string" ? raw.aud : Array.isArray(raw.aud) ? raw.aud[0] ?? "" : "",
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

  // Structural checks beyond what jose validates automatically
  if (!payload.sub) {
    return { valid: false, reason: "missing_subject" };
  }
  if (!payload.scope) {
    return { valid: false, reason: "missing_scope" };
  }

  // Optional session scope match
  if (expectedSessionId !== undefined && payload.scope !== expectedSessionId) {
    return { valid: false, reason: "session_scope_mismatch" };
  }

  return { valid: true, payload };
}
