import { toNextJsHandler } from "better-auth/next-js";

import { env } from "~/env";
import { auth } from "~/server/better-auth";

const nextJsAuthHandlers = toNextJsHandler(auth.handler);

function getOriginFromUrl(urlValue: string | null | undefined): string | null {
  if (!urlValue) {
    return null;
  }

  try {
    return new URL(urlValue).origin;
  } catch {
    return null;
  }
}

const allowedOrigins = new Set(
  [
    env.PODIUM_APP_URL,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    env.BETTER_AUTH_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ]
    .map(getOriginFromUrl)
    .filter((origin): origin is string => origin !== null),
);

function appendVaryHeader(headers: Headers, value: string): void {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", value);
    return;
  }

  if (!current.split(",").map((part) => part.trim().toLowerCase()).includes(value.toLowerCase())) {
    headers.set("Vary", `${current}, ${value}`);
  }
}

function withCorsHeaders(response: Response, request: Request): Response {
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

export async function GET(request: Request): Promise<Response> {
  const response = await nextJsAuthHandlers.GET(request);
  return withCorsHeaders(response, request);
}

export async function POST(request: Request): Promise<Response> {
  const response = await nextJsAuthHandlers.POST(request);
  return withCorsHeaders(response, request);
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
