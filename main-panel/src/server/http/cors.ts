import os from "node:os";

/**
 * Shared cross-origin allowlist helper for routes podium (a separate
 * app/origin) calls directly. Local dev origins (localhost, LAN IPs, and
 * this machine's hostname) are only included outside production -- a
 * production build must not silently accept requests claiming to be a
 * developer's local machine.
 */

const DEV_PORTS = [3000, 3001, 5173];

export function getLocalDevOrigins(): string[] {
  const origins = new Set<string>();

  const addOrigin = (host: string, port: number): void => {
    if (!host) return;
    const normalizedHost = host.includes(":") && !host.startsWith("[") && !host.startsWith("http")
      ? `[${host}]`
      : host;
    origins.add(`http://${normalizedHost}:${port}`);
  };

  for (const port of DEV_PORTS) {
    addOrigin("localhost", port);
    addOrigin("127.0.0.1", port);
    addOrigin("0.0.0.0", port);
    addOrigin("::1", port);

    const hostName = os.hostname();
    if (hostName) {
      const candidateNames = [hostName, hostName.toLowerCase(), hostName.toUpperCase()];
      for (const candidate of candidateNames) {
        addOrigin(candidate, port);
      }
    }
  }

  for (const [_, addresses] of Object.entries(os.networkInterfaces())) {
    for (const info of addresses ?? []) {
      if (!info || info.family !== "IPv4" || info.internal) continue;
      for (const port of DEV_PORTS) {
        addOrigin(info.address, port);
      }
    }
  }

  return Array.from(origins);
}

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
  const urls = process.env.NODE_ENV === "production" ? extraUrls : [...extraUrls, ...getLocalDevOrigins()];
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
