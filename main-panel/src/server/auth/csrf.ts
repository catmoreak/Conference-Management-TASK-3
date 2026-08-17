/**
 * CSRF protection for custom (non-Better-Auth) routes.
 *
 * Better Auth handles CSRF on its own endpoints via origin-header validation.
 * This module replicates that logic for our custom POST/PUT/DELETE routes
 * that sit outside Better Auth's handler.
 */

import { buildAllowedOrigins, getLocalDevOrigins, getOriginFromUrl } from "~/server/http/cors";

function isTrustedOrigin(origin: string, request: Request): boolean {
  const normalizedOrigin = origin.trim().toLowerCase();

  // Allow desktop / electron apps running with null or file protocol
  if (normalizedOrigin === "null" || normalizedOrigin.startsWith("file://")) {
    return true;
  }

  // 1. Check against all allowed origins (env.ALLOWED_ORIGINS, BETTER_AUTH_URL, PODIUM_APP_URL, and local dev)
  const allowed = buildAllowedOrigins(process.env.BETTER_AUTH_URL, process.env.PODIUM_APP_URL);
  for (const item of allowed) {
    if (item.toLowerCase() === normalizedOrigin) {
      return true;
    }
  }

  // 2. Check internal request.url origin
  try {
    const requestUrl = new URL(request.url);
    if (requestUrl.origin.toLowerCase() === normalizedOrigin) {
      return true;
    }
  } catch {}

  // 3. Check reverse proxy headers (e.g. AWS ALB, CloudFront, Nginx)
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (forwardedHost) {
    const proto = forwardedProto.split(",")[0]?.trim() ?? "https";
    const host = forwardedHost.split(",")[0]?.trim();
    if (host) {
      const forwardedOrigin = `${proto}://${host}`.toLowerCase();
      if (forwardedOrigin === normalizedOrigin) {
        return true;
      }
    }
  }

  // 4. Check local development origins and aliases (localhost, 127.0.0.1, LAN IPs)
  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.hostname.toLowerCase();
    if (originHost === "localhost" || originHost === "127.0.0.1" || originHost === "::1" || originHost === "0.0.0.0") {
      return true;
    }
    const localDevOrigins = new Set(getLocalDevOrigins().map((o) => o.toLowerCase()));
    if (localDevOrigins.has(normalizedOrigin)) {
      return true;
    }
  } catch {}

  return false;
}

/**
 * Validate CSRF by checking the Origin or Referer header against trusted origins.
 *
 * Better Auth uses origin-based CSRF protection by default. This function
 * applies the same mechanism to custom routes.
 *
 * @param request - The incoming Request object
 * @throws Object with `status` and `error` if CSRF check fails
 */
export function validateCsrf(request: Request): void {
  const method = request.method.toUpperCase();

  // Only validate state-changing methods
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return;
  }

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // At least one of origin or referer must be present
  if (!origin && !referer) {
    throw {
      status: 403,
      error: "CSRF validation failed: missing Origin and Referer headers",
    };
  }

  // Check origin header first
  if (origin) {
    if (!isTrustedOrigin(origin, request)) {
      throw {
        status: 403,
        error: "CSRF validation failed: origin mismatch",
      };
    }
    return;
  }

  // Fallback to referer header
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (!isTrustedOrigin(refererUrl.origin, request)) {
        throw {
          status: 403,
          error: "CSRF validation failed: referer origin mismatch",
        };
      }
    } catch {
      throw {
        status: 403,
        error: "CSRF validation failed: invalid referer URL",
      };
    }
  }
}
