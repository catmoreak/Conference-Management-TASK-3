import { TRPCError } from "@trpc/server";

export type CoreRole = "admin" | "reviewer" | "presenter";

export function assertCanManageCoreData(role?: string | null) {
  if (role !== "admin" && role !== "reviewer") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only admin and reviewer roles can create, update, or delete rooms and presenters.",
    });
  }
}

export async function assertPresenterReadAccess(
  db: {
    presenter: {
      findFirst: (args: { where: Record<string, unknown> }) => Promise<{ id: string } | null>;
      count: (args: { where: Record<string, unknown> }) => Promise<number>;
    };
    liveSession: {
      findFirst: (args: { where: Record<string, unknown> }) => Promise<{ id: string } | null>;
    };
  },
  role: string | undefined,
  userId: string | undefined,
  eventId: string,
) {
  if (role !== "presenter") return;
  if (!userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Presenter access requires an authenticated user.",
    });
  }

  const hasPresenterRecord = await db.presenter.findFirst({
    where: { eventId, userId },
  });

  if (hasPresenterRecord) return;

  const hasAssignedSession = await db.liveSession.findFirst({
    where: {
      eventId,
      deletedAt: null,
      presentationAssignments: { some: { presenter: { userId } } },
    },
  });

  if (!hasAssignedSession) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Presenter access is limited to events where you are assigned as a presenter.",
    });
  }
}

export async function ensureUniqueRoomName(
  db: { room: { findFirst: (args: { where: Record<string, unknown> }) => Promise<{ id: string } | null> } },
  eventId: string,
  name: string,
  ignoreId?: string,
) {
  const normalized = name.trim();
  const existing = await db.room.findFirst({
    where: {
      eventId,
      name: normalized,
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
    },
  });

  if (existing) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Room name "${normalized}" already exists for this event.`,
    });
  }
}

export async function ensureUniquePresenterEmail(
  db: { presenter: { findFirst: (args: { where: Record<string, unknown> }) => Promise<{ id: string } | null> } },
  eventId: string,
  email: string,
  ignoreId?: string,
) {
  const normalized = email.trim();
  const existing = await db.presenter.findFirst({
    where: {
      eventId,
      email: normalized,
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
    },
  });

  if (existing) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Presenter email "${normalized}" already exists for this event.`,
    });
  }
}

export async function getEventCounts(db: {
  room: { count: (args: { where: Record<string, unknown> }) => Promise<number> };
  liveSession: { count: (args: { where: Record<string, unknown> }) => Promise<number> };
  presenter: { count: (args: { where: Record<string, unknown> }) => Promise<number> };
}, eventId: string) {
  const [roomCount, sessionCount, presenterCount] = await Promise.all([
    db.room.count({ where: { eventId } }),
    db.liveSession.count({ where: { eventId, deletedAt: null } }),
    db.presenter.count({ where: { eventId } }),
  ]);

  return {
    room_count: roomCount,
    session_count: sessionCount,
    presenter_count: presenterCount,
  };
}
