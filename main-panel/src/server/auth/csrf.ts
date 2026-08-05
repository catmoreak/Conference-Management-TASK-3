/**
 * CSRF protection for custom (non-Better-Auth) routes.
 *
 * Better Auth handles CSRF on its own endpoints via origin-header validation.
 * This module replicates that logic for our custom POST/PUT/DELETE routes
 * that sit outside Better Auth's handler.
 */

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
    if (origin !== trustedOrigin) {
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
      if (refererUrl.origin !== trustedOrigin) {
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
