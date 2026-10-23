import "server-only";
import { TRPC_ERROR_CODES_BY_KEY } from "@trpc/server/rpc";
import superjson from "superjson";
import { BodyReadError, readRequestText } from "~/server/security/request-body";
import { MAX_RAW_BODY_BYTES } from "~/server/services/token2api.contract";
import { MAX_TRPC_BATCH_SIZE } from "~/shared/trpc-limits";

function denied(status: 400 | 408 | 413, message: string) {
	const code =
		status === 413
			? "PAYLOAD_TOO_LARGE"
			: status === 408
				? "TIMEOUT"
				: "BAD_REQUEST";
	return Response.json(
		{
			error: superjson.serialize({
				message,
				code: TRPC_ERROR_CODES_BY_KEY[code],
				data: { code, httpStatus: status, zodError: null },
			}),
		},
		{
			status,
			headers: {
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
			},
		},
	);
}

/** Bound input before tRPC deserializes JSON or invokes authentication or services. */
export function withTRPCRequestLimits(
	handler: (request: Request) => Promise<Response>,
) {
	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		let path: string;
		try {
			path = decodeURIComponent(url.pathname);
		} catch {
			return denied(400, "Invalid request path");
		}
		if (
			url.searchParams.get("batch") === "1" &&
			path.split(",").length > MAX_TRPC_BATCH_SIZE
		) {
			void request.body?.cancel().catch(() => undefined);
			return denied(400, "Batch call exceeds maximum size");
		}
		if (
			Buffer.byteLength(url.searchParams.get("input") ?? "", "utf8") >
			MAX_RAW_BODY_BYTES
		)
			return denied(413, "Request input exceeds 160 KiB");
		if (!request.body) return handler(request);
		let text: string;
		try {
			text = await readRequestText(request);
		} catch (error) {
			return error instanceof BodyReadError
				? denied(error.status, error.message)
				: denied(400, "Request body could not be read");
		}
		// Frameworks can wrap Request in a Proxy. Native Request cloning reads
		// private fields directly, so rebuild from the public request properties.
		return handler(
			new Request(request.url, {
				method: request.method,
				headers: Array.from(request.headers.entries()),
				signal: request.signal,
				body: text,
			}),
		);
	};
}
