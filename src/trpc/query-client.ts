import {
	defaultShouldDehydrateQuery,
	QueryClient,
} from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import SuperJSON from "superjson";

/** Retry only transient failures. 4xx, including 429, will not pass on an immediate retry. */
export function retryTransient(failureCount: number, error: unknown) {
	const status =
		error instanceof TRPCClientError ? error.data?.httpStatus : undefined;
	if (typeof status === "number" && status >= 400 && status < 500) return false;
	return failureCount < 2;
}

export const createQueryClient = () =>
	new QueryClient({
		defaultOptions: {
			queries: {
				// With SSR, we usually want to set some default staleTime
				// above 0 to avoid refetching immediately on the client
				staleTime: 30 * 1000,
				retry: retryTransient,
				retryDelay: (attempt) =>
					Math.min(1000 * 2 ** attempt, 10_000) * (0.5 + Math.random()),
			},
			dehydrate: {
				serializeData: SuperJSON.serialize,
				shouldDehydrateQuery: (query) =>
					defaultShouldDehydrateQuery(query) ||
					query.state.status === "pending",
			},
			hydrate: {
				deserializeData: SuperJSON.deserialize,
			},
		},
	});
