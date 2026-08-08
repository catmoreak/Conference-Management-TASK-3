import { postRouter } from "~/server/api/routers/post";
import { clientRouter } from "~/server/api/routers/client";
import { eventRouter } from "~/server/api/routers/event";
import { roomRouter } from "~/server/api/routers/room";
import { liveSessionRouter } from "~/server/api/routers/liveSession";
import { presenterRouter } from "~/server/api/routers/presenter";
import { presentationAssignmentRouter } from "~/server/api/routers/presentationAssignment";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  post: postRouter,
  clients: clientRouter,
  event: eventRouter,
  room: roomRouter,
  liveSession: liveSessionRouter,
  presenter: presenterRouter,
  presentationAssignment: presentationAssignmentRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
