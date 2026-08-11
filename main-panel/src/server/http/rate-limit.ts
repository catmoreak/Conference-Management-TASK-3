/**
 * Minimal in-memory fixed-window rate limiter for routes that sit outside
 * Better Auth's own handler (which has its own built-in limiter, see
 * server/better-auth/config.ts). Same "memory" storage model as that one --
 * appropriate here because main-panel runs as a long-lived Node process
 * (the standalone ws-server.ts alongside it wouldn't make sense otherwise),
 * not a per-request serverless function where in-memory state wouldn't
 * persist between invocations.
 *
 * Primarily for the anonymous, no-login check-in endpoints -- the most
 * exposed surface in the app, with no auth to fall back on for abuse
 * control.
 */

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/** Periodic cleanup so long-lived buckets from one-off callers don't leak forever. */
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function sweep(now: number, windowMs: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > windowMs) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry, only set when allowed is false. */
  retryAfterSeconds?: number;
}

/**
 * @param key        Identity to rate-limit on, e.g. `checkin-upload:${ip}`.
 * @param max        Max requests allowed within the window.
 * @param windowMs   Window size in milliseconds.
 */
export function checkRateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now, windowMs);

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (bucket.count >= max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.windowStart + windowMs - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true };
}
