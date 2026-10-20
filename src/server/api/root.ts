import { token2apiRouter } from "~/server/api/routers/token2api";
import { createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
	token2api: token2apiRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
