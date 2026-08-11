import type { Prisma } from "../../../generated/prisma";

import { env } from "~/env";
import { db } from "~/server/db";

/**
 * Sensitive field patterns that must NEVER appear in audit log data.
 * Covers passwords, tokens, secrets, CSRF tokens, MFA secrets.
 */
const SENSITIVE_PATTERNS = /password|token|secret|csrf|otp|backup_?code/i;

/**
 * Sanitize a value to ensure no credentials/tokens leak into logs.
 * Returns "[REDACTED]" for any field whose key matches a sensitive pattern.
 */
function sanitizeForLog(key: string, value: unknown): unknown {
  if (SENSITIVE_PATTERNS.test(key)) {
    return "[REDACTED]";
  }
  return value;
}

export interface AuditLogParams {
  actor_id: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  result: string;
  /** Optional metadata — will be sanitized before storage */
  metadata?: Record<string, unknown>;
}

/**
 * Write an audit log entry to the database.
 *
 * All sensitive fields (passwords, tokens, secrets, CSRF tokens, MFA secrets)
 * are automatically stripped before being written.
 */
export async function writeAuditLog(params: AuditLogParams): Promise<void> {
  try {
    // Sanitize metadata if present
    const sanitizedMeta = params.metadata
      ? Object.fromEntries(
          Object.entries(params.metadata).map(([k, v]) => [
            k,
            sanitizeForLog(k, v),
          ]),
        )
      : undefined;

    await db.auditLog.create({
      data: {
        actor_id: params.actor_id,
        action: params.action,
        target_type: params.target_type ?? null,
        target_id: params.target_id ?? null,
        ip: params.ip ?? null,
        user_agent: params.user_agent ?? null,
        result: params.result,
        metadata: (sanitizedMeta as Prisma.InputJsonValue) ?? undefined,
      },
    });
  } catch (error) {
    // Audit logging must never crash the request — log to stderr and continue
    console.error("[AUDIT] Failed to write audit log:", error);
  }
}

/**
 * Extract IP address from request headers.
 *
 * X-Forwarded-For is a plain client-supplied header -- trusting its
 * leftmost (client-claimed) entry outright lets any caller forge it, which
 * both poisons the audit trail and lets the checkin-upload rate limiter be
 * bypassed by rotating a fake IP per request. With TRUST_PROXY_HOPS trusted
 * reverse proxies in front of us, each proxy appends the address it
 * actually observed as the next entry, so the only trustworthy value is
 * the one written by the proxy nearest to us -- the hops-th entry from the
 * right, never the client-supplied left end. TRUST_PROXY_HOPS=0 (a direct-
 * exposure deployment) disables X-Forwarded-For trust entirely.
 */
export function extractIp(headers: Headers): string | null {
  const hops = env.TRUST_PROXY_HOPS;
  if (hops <= 0) return null;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const chain = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (chain.length === 0) return null;
    const index = Math.max(0, chain.length - hops);
    return chain[index] ?? null;
  }
  return headers.get("x-real-ip") ?? null;
}

/**
 * Extract user agent from request headers.
 */
export function extractUserAgent(headers: Headers): string | null {
  return headers.get("user-agent") ?? null;
}
