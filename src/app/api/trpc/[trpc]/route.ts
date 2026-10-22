import * as Sentry from "@sentry/nextjs";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { env } from "~/env";
import { withTRPCRequestLimits } from "~/server/api/request";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { logger } from "~/server/observability/logger";
import { MAX_TRPC_BATCH_SIZE } from "~/shared/trpc-limits";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: Request) => {
	return createTRPCContext({
		headers: req.headers,
	});
};

const handler = withTRPCRequestLimits((req) =>
	fetchRequestHandler({
		endpoint: "/api/trpc",
		req,
		router: appRouter,
		maxBatchSize: MAX_TRPC_BATCH_SIZE,
		createContext: () => createContext(req),
		onError: ({ path, error }) => {
			Sentry.captureException(error);
			logger.error(
				{
					environment: env.NODE_ENV,
					path,
					err: error,
				},
				"tRPC request failed",
			);
		},
	}),
);

export { handler as GET, handler as POST };
