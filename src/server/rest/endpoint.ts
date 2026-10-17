import "server-only";

import type { z } from "zod";
import { withCors } from "~/server/security/cors";
import { limitRequest } from "~/server/security/rate-limit";
import {
	jsonError,
	jsonOk,
	logAndReturnInternalError,
} from "~/server/security/rest-response";
import {
	BODY_READ_TIMEOUT_MS,
	MAX_RAW_BODY_BYTES,
} from "~/server/services/mon2api.contract";

type RestHandlerResult<TBody> =
	| Response
	| {
			body: TBody;
			init?: ResponseInit;
	  };

type RestQueryOptions<TBody> = {
	route: string;
	handler: (ctx: { request: Request }) => Promise<RestHandlerResult<TBody>>;
};

type RestMutationOptions<TSchema extends z.ZodTypeAny, TBody> = {
	route: string;
	input: TSchema;
	handler: (ctx: {
		input: z.infer<TSchema>;
		request: Request;
	}) => Promise<RestHandlerResult<TBody>>;
};

export function createRestQuery<TBody>(options: RestQueryOptions<TBody>) {
	return async function restQuery(request: Request) {
		return runWithRateLimit(request, options.route, () =>
			options.handler({ request }),
		);
	};
}

export function createRestMutation<TSchema extends z.ZodTypeAny, TBody>(
	options: RestMutationOptions<TSchema, TBody>,
) {
	return async function restMutation(request: Request) {
		return runWithRateLimit(request, options.route, async () => {
			let json: unknown;
			try {
				json = await readJsonBody(request);
			} catch (error) {
				return jsonError(
					request,
					"invalid_request",
					error instanceof BodyReadError ? error.message : "Invalid JSON body",
					error instanceof BodyReadError ? error.status : 400,
				);
			}

			const parsed = options.input.safeParse(json);
			if (!parsed.success) {
				return jsonError(
					request,
					"invalid_request",
					"Invalid request body",
					400,
					parsed.error.flatten(),
				);
			}

			return options.handler({ input: parsed.data, request });
		});
	};
}

class BodyReadError extends Error {
	constructor(
		message: string,
		readonly status: 408 | 413,
	) {
		super(message);
	}
}

async function readJsonBody(request: Request): Promise<unknown> {
	if (!request.body) throw new SyntaxError("Missing JSON body");
	const reader = request.body.getReader();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const text = await Promise.race([
			(async () => {
				const decoder = new TextDecoder();
				let bytes = 0;
				let text = "";
				while (true) {
					const { done, value } = await reader.read();
					if (done) return text + decoder.decode();
					bytes += value.byteLength;
					if (bytes > MAX_RAW_BODY_BYTES) {
						throw new BodyReadError("Request body exceeds 160 KiB", 413);
					}
					text += decoder.decode(value, { stream: true });
				}
			})(),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new BodyReadError("Request body read timed out", 408)),
					BODY_READ_TIMEOUT_MS,
				);
			}),
		]);
		return JSON.parse(text);
	} catch (error) {
		// A source's cancel callback may never settle. Do not delay the error response.
		void reader.cancel().catch(() => undefined);
		throw error;
	} finally {
		clearTimeout(timeout);
		reader.releaseLock();
	}
}

async function runWithRateLimit<TBody>(
	request: Request,
	route: string,
	handler: () => Promise<RestHandlerResult<TBody>>,
) {
	try {
		const rateLimit = await limitRequest(request, route);
		if (!rateLimit.success) {
			return jsonError(request, "rate_limited", "Too many requests", 429, {
				limit: rateLimit.limit,
				remaining: rateLimit.remaining,
				reset: rateLimit.reset,
			});
		}

		return toResponse(request, await handler());
	} catch (error) {
		return logAndReturnInternalError(request, error);
	}
}

function toResponse<TBody>(request: Request, result: RestHandlerResult<TBody>) {
	if (result instanceof Response) {
		return withCors(request, result);
	}

	return jsonOk(request, result.body, result.init);
}
