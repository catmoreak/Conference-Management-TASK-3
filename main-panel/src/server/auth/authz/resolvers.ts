/**
 * Resource resolvers: turn a Prisma record into the AuthzResource shape
 * canUserPerform decides against. tenantId is deliberately never stored
 * directly on LiveSession/Submission/Room/Presenter/PresentationAssignment
 * -- it's derived here through the Event relation on every call, so it
 * can never drift from its parent event's tenant. Not wired to any route yet.
 */

import { db } from "~/server/db";
import type { AuthzResource } from "./types";

export async function resolveEventResource(eventId: string): Promise<AuthzResource | null> {
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) return null;
  return {
    type: "event",
    id: event.id,
    eventId: event.id,
    tenantId: event.tenantId,
  };
}

export async function resolveLiveSessionResource(liveSessionId: string): Promise<AuthzResource | null> {
  const liveSession = await db.liveSession.findUnique({
    where: { id: liveSessionId },
    include: { event: true },
  });
  if (!liveSession) return null;
  return {
    type: "session",
    id: liveSession.id,
    eventId: liveSession.eventId,
    sessionId: liveSession.id,
    tenantId: liveSession.event.tenantId,
  };
}

export async function resolveSubmissionResource(submissionId: string): Promise<AuthzResource | null> {
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: { event: true },
  });
  if (!submission) return null;
  return {
    type: "submission",
    id: submission.id,
    eventId: submission.eventId,
    sessionId: submission.liveSessionId ?? undefined,
    ownerId: submission.ownerId,
    status: submission.status,
    tenantId: submission.event.tenantId,
  };
}

export async function resolveRoomResource(roomId: string): Promise<AuthzResource | null> {
  const room = await db.room.findUnique({
    where: { id: roomId },
    include: { event: true },
  });
  if (!room) return null;
  return {
    type: "room",
    id: room.id,
    eventId: room.eventId,
    tenantId: room.event.tenantId,
  };
}

export async function resolvePresenterResource(presenterId: string): Promise<AuthzResource | null> {
  const presenter = await db.presenter.findUnique({
    where: { id: presenterId },
    include: { event: true },
  });
  if (!presenter) return null;
  return {
    type: "presenter",
    id: presenter.id,
    eventId: presenter.eventId,
    tenantId: presenter.event.tenantId,
  };
}

export async function resolvePresentationAssignmentResource(assignmentId: string): Promise<AuthzResource | null> {
  const assignment = await db.presentationAssignment.findUnique({
    where: { id: assignmentId },
    include: { liveSession: { include: { event: true } } },
  });
  if (!assignment) return null;
  return {
    type: "assignment",
    id: assignment.id,
    eventId: assignment.liveSession.eventId,
    sessionId: assignment.liveSessionId,
    tenantId: assignment.liveSession.event.tenantId,
  };
}
