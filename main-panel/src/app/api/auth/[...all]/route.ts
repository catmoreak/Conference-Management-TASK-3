import { toNextJsHandler } from "better-auth/next-js";

import { env } from "~/env";
import { auth } from "~/server/better-auth";
import { buildAllowedOrigins, getOriginFromUrl, isAllowedOrigin, withCorsHeaders } from "~/server/http/cors";

const nextJsAuthHandlers = toNextJsHandler(auth.handler);

const allowedOrigins = buildAllowedOrigins(env.PODIUM_APP_URL, env.BETTER_AUTH_URL);

function normalizeDesktopOrigin(request: Request): Request {
  const origin = request.headers.get("origin");
  const userAgent = (request.headers.get("user-agent") ?? "").toLowerCase();
  if (!userAgent.includes("electron")) {
    return request;
  }

  const normalizedOrigin = origin?.trim().toLowerCase();
  const needsOriginRewrite =
    !origin ||
    normalizedOrigin === "null" ||
    normalizedOrigin?.startsWith("file://") === true ||
    !isAllowedOrigin(origin, allowedOrigins);
  if (!needsOriginRewrite) {
    return request;
  }

  const fallbackOrigin =
    getOriginFromUrl(env.BETTER_AUTH_URL) ??
    getOriginFromUrl(env.PODIUM_APP_URL);
  if (!fallbackOrigin) {
    return request;
  }

  const headers = new Headers(request.headers);
  headers.set("origin", fallbackOrigin);
  if (!headers.get("referer")) {
    headers.set("referer", `${fallbackOrigin}/`);
  }

  return new Request(request, { headers });
}

export async function GET(request: Request): Promise<Response> {
  const normalizedRequest = normalizeDesktopOrigin(request);
  const response = await nextJsAuthHandlers.GET(normalizedRequest);
  return withCorsHeaders(response, normalizedRequest, allowedOrigins);
}

export async function POST(request: Request): Promise<Response> {
  const normalizedRequest = normalizeDesktopOrigin(request);
  const response = await nextJsAuthHandlers.POST(normalizedRequest);
  return withCorsHeaders(response, normalizedRequest, allowedOrigins);
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const requestedHeaders =
    request.headers.get("access-control-request-headers") ??
    "content-type,authorization";

  const headers = new Headers();
  headers.set("Vary", "Origin, Access-Control-Request-Headers");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", requestedHeaders);
  headers.set("Access-Control-Allow-Credentials", "true");

  if (isAllowedOrigin(origin, allowedOrigins)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return new Response(null, { status: 204, headers });
}
