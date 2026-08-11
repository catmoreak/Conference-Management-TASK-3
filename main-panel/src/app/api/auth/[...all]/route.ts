import { toNextJsHandler } from "better-auth/next-js";

import { env } from "~/env";
import { auth } from "~/server/better-auth";
import { buildAllowedOrigins, withCorsHeaders } from "~/server/http/cors";

const nextJsAuthHandlers = toNextJsHandler(auth.handler);

const allowedOrigins = buildAllowedOrigins(env.PODIUM_APP_URL, env.BETTER_AUTH_URL);

export async function GET(request: Request): Promise<Response> {
  const response = await nextJsAuthHandlers.GET(request);
  return withCorsHeaders(response, request, allowedOrigins);
}

export async function POST(request: Request): Promise<Response> {
  const response = await nextJsAuthHandlers.POST(request);
  return withCorsHeaders(response, request, allowedOrigins);
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

  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return new Response(null, { status: 204, headers });
}
