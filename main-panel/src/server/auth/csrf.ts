/**
 * CSRF protection for custom (non-Better-Auth) routes.
 *
 * Better Auth handles CSRF on its own endpoints via origin-header validation.
 * This module replicates that logic for our custom POST/PUT/DELETE routes
 * that sit outside Better Auth's handler.
 */

import { getLocalDevOrigins } from "~/server/http/cors";

function isAllowedLocalDevOrigin(origin: string, requestUrl: URL): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  const allowedOrigins = new Set(getLocalDevOrigins());
  const normalizedOrigin = origin.trim().toLowerCase();
  if (allowedOrigins.has(normalizedOrigin)) {
    return true;
  }

  const requestOrigin = requestUrl.origin.toLowerCase();
  const requestHost = requestUrl.hostname.toLowerCase();

  try {
    const originUrl = new URL(origin);
    const sameHost = originUrl.hostname.toLowerCase() === requestHost;
    const samePort = originUrl.port === requestUrl.port;
    const sameMachineAlias = sameHost && samePort && requestOrigin !== normalizedOrigin;
    return sameMachineAlias || originUrl.origin.toLowerCase() === requestOrigin;
  } catch {
    return false;
  }
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

  // Determine the trusted origin from the request URL
  const requestUrl = new URL(request.url);
  const trustedOrigin = requestUrl.origin;

  // Check origin header first
  if (origin) {
    if (origin !== trustedOrigin && !isAllowedLocalDevOrigin(origin, requestUrl)) {
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
      if (refererUrl.origin !== trustedOrigin && !isAllowedLocalDevOrigin(refererUrl.origin, requestUrl)) {
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
