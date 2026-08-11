/**
 * Shared cross-origin allowlist helper for routes podium (a separate
 * app/origin) calls directly. Local dev origins (localhost:5173/3000/3001)
 * are only included outside production -- a production build must not
 * silently accept requests claiming to be a developer's local machine.
 */

const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];

export function getOriginFromUrl(urlValue: string | null | undefined): string | null {
  if (!urlValue) return null;
  try {
    return new URL(urlValue).origin;
  } catch {
    return null;
  }
}

/**
 * Builds the allowed-origins set for a route. `extraUrls` are always
 * included (e.g. env.PODIUM_APP_URL, env.BETTER_AUTH_URL) -- these are the
 * real production origins. Local dev origins are appended only when
 * NODE_ENV !== "production".
 */
export function buildAllowedOrigins(...extraUrls: (string | null | undefined)[]): Set<string> {
  const urls = process.env.NODE_ENV === "production" ? extraUrls : [...extraUrls, ...DEV_ORIGINS];
  return new Set(
    urls.map(getOriginFromUrl).filter((origin): origin is string => origin !== null),
  );
}

export function withCorsHeaders(response: Response, request: Request, allowedOrigins: Set<string>): Response {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.has(origin)) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  appendVaryHeader(headers, "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function appendVaryHeader(headers: Headers, value: string): void {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", value);
    return;
  }
  if (!current.split(",").map((part) => part.trim().toLowerCase()).includes(value.toLowerCase())) {
    headers.set("Vary", `${current}, ${value}`);
  }
}
