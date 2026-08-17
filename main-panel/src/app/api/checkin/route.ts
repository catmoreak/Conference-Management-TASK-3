import { NextResponse } from "next/server";
import { env } from "~/env";
import { db } from "~/server/db";
import { extractIp } from "~/server/auth/audit";
import { checkRateLimit } from "~/server/http/rate-limit";
import { buildAllowedOrigins, isAllowedOrigin, withCorsHeaders } from "~/server/http/cors";

/**
 * Public check-in API — no authentication required.
 * Used by the kiosk screen to fetch events and presenters, and by podium
 * (a separate app/origin) to populate its "connect as display" event
 * picker, so it needs the same CORS-allowlist treatment as the other
 * podium-facing routes.
 */

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

const allowedOrigins = buildAllowedOrigins(env.PODIUM_APP_URL, env.BETTER_AUTH_URL);

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const headers = new Headers();
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  headers.set("Access-Control-Allow-Credentials", "true");
  if (isAllowedOrigin(origin, allowedOrigins)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return new Response(null, { status: 204, headers });
}

// GET /api/checkin?eventId=<uuid> — fetch presenters for an event
// GET /api/checkin — fetch all active events
export async function GET(request: Request) {
  try {
    const ip = extractIp(request.headers) ?? "unknown";
    const limit = checkRateLimit(`checkin-get:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!limit.allowed) {
      return withCorsHeaders(
        NextResponse.json(
          { error: "Too many requests" },
          { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
        ),
        request,
        allowedOrigins,
      );
    }

    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get("eventId");

    if (eventId) {
      // Return presenters for the selected event
      const presenters = await db.presenter.findMany({
        where: { eventId },
        orderBy: [
          { organization: "asc" },
          { displayName: "asc" },
        ],
        select: {
          id: true,
          displayName: true,
          organization: true,
          title: true,
          presentationAssignments: {
            select: {
              id: true,
              liveSession: {
                select: {
                  id: true,
                  name: true,
                  startsAt: true,
                  room: { select: { name: true } },
                },
              },
            },
          },
          // Most recent non-deleted submission -- lets the kiosk tell a
          // returning presenter their status (and rejection reason, if
          // any) instead of them re-uploading blind.
          submissions: {
            where: { deletedAt: null },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              fileName: true,
              reviewNote: true,
              createdAt: true,
            },
          },
        },
      });
      return withCorsHeaders(NextResponse.json({ presenters }), request, allowedOrigins);
    }

    // Return list of active events
    const events = await db.event.findMany({
      where: { status: "published" },
      orderBy: { startDate: "asc" },
      select: {
        id: true,
        name: true,
        location: true,
        startDate: true,
        endDate: true,
      },
    });
    return withCorsHeaders(NextResponse.json({ events }), request, allowedOrigins);

  } catch (error) {
    console.error("[checkin] Error:", error);
    return withCorsHeaders(
      NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      ),
      request,
      allowedOrigins,
    );
  }
}