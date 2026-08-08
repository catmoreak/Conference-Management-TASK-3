import { NextResponse } from "next/server";
import { db } from "~/server/db";

/**
 * Public check-in API — no authentication required.
 * Used by the kiosk screen to fetch events and presenters.
 */

// GET /api/checkin?eventId=<uuid> — fetch presenters for an event
// GET /api/checkin — fetch all active events
export async function GET(request: Request) {
  try {
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