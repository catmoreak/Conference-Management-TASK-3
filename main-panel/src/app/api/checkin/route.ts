import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { extractIp } from "~/server/auth/audit";
import { checkRateLimit } from "~/server/http/rate-limit";

/**
 * Public check-in API — no authentication required.
 * Used by the kiosk screen to fetch events and presenters.
 */

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

// GET /api/checkin?eventId=<uuid> — fetch presenters for an event
// GET /api/checkin — fetch all active events
export async function GET(request: Request) {
  try {
    const ip = extractIp(request.headers) ?? "unknown";
    const limit = checkRateLimit(`checkin-get:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
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
      return NextResponse.json({ presenters });
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
    return NextResponse.json({ events });

  } catch (error) {
    console.error("[checkin] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}