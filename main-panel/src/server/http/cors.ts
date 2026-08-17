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
  const trimmed = urlValue.trim();
  if (!trimmed) return null;
  try {
    const formatted = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
    return new URL(formatted).origin;
  } catch {
    return null;
  }
}

export function parseConfiguredOrigins(envValue?: string | null): string[] {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(getOriginFromUrl)
    .filter((origin): origin is string => origin !== null);
}

/**
 * Builds the allowed-origins set for a route. `extraUrls` and `ALLOWED_ORIGINS`
 * are always included (e.g. env.ALLOWED_ORIGINS, env.PODIUM_APP_URL, env.BETTER_AUTH_URL).
 * Local dev origins are appended in development or when no explicit production origins are specified.
 */
export function buildAllowedOrigins(...extraUrls: (string | null | undefined)[]): Set<string> {
  const envOrigins = parseConfiguredOrigins(process.env.ALLOWED_ORIGINS);
  const extraConfigured = extraUrls.map(getOriginFromUrl).filter((origin): origin is string => origin !== null);
  
  const allOrigins = new Set<string>([
    ...envOrigins,
    ...extraConfigured,
  ]);

  if (process.env.NODE_ENV !== "production" || allOrigins.size === 0) {
    for (const devOrigin of getLocalDevOrigins()) {
      allOrigins.add(devOrigin);
    }
  }

  return allOrigins;
}

export function isDesktopOrigin(origin: string | null | undefined): origin is string {
  if (!origin) return false;
  const normalized = origin.trim().toLowerCase();
  return normalized === "null" || normalized.startsWith("file://");
}

export function isAllowedOrigin(origin: string | null, allowedOrigins: Set<string>): origin is string {
  if (!origin) return false;
  return isDesktopOrigin(origin) || allowedOrigins.has(origin);
}

export function withCorsHeaders(response: Response, request: Request, allowedOrigins: Set<string>): Response {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin, allowedOrigins)) {
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
