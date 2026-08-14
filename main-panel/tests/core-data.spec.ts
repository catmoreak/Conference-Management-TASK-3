import { describe, expect, it } from "vitest";
import {
  assertCanManageCoreData,
  ensureUniquePresenterEmail,
  ensureUniqueRoomName,
  getEventCounts,
} from "../src/server/core-data";
import { TRPCError } from "@trpc/server";

describe("core data inventory", () => {
  it("allows admin and reviewer roles to manage rooms and presenters", () => {
    expect(() => assertCanManageCoreData("admin")).not.toThrow();
    expect(() => assertCanManageCoreData("reviewer")).not.toThrow();
    expect(() => assertCanManageCoreData("presenter")).toThrow(TRPCError);
  });

  it("rejects duplicate room names within an event", async () => {
    const db = {
      room: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          where.eventId === "event-1" && where.name === "Main Hall" ? { id: "room-1" } : null,
      },
    };

    await expect(ensureUniqueRoomName(db as any, "event-1", "Main Hall")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects duplicate presenter emails within an event", async () => {
    const db = {
      presenter: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          where.eventId === "event-1" && where.email === "speaker@example.com" ? { id: "presenter-1" } : null,
      },
    };

    await expect(ensureUniquePresenterEmail(db as any, "event-1", "speaker@example.com")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("counts rooms, sessions and presenters via aggregate queries", async () => {
    const db = {
      room: { count: async ({ where }: { where: Record<string, unknown> }) => where.eventId === "event-1" ? 4 : 0 },
      liveSession: { count: async ({ where }: { where: Record<string, unknown> }) => where.eventId === "event-1" && where.deletedAt === null ? 7 : 0 },
      presenter: { count: async ({ where }: { where: Record<string, unknown> }) => where.eventId === "event-1" ? 3 : 0 },
    };

    await expect(getEventCounts(db as any, "event-1")).resolves.toEqual({
      room_count: 4,
      session_count: 7,
      presenter_count: 3,
    });
  });
});
