import "server-only";

import type { z } from "zod";
import { withCors } from "~/server/security/cors";
import { limitCredential, limitRequest } from "~/server/security/rate-limit";
import { BodyReadError, readRequestText } from "~/server/security/request-body";
import {
	jsonError,
	jsonOk,
	logAndReturnInternalError,
} from "~/server/security/rest-response";
import { AppError } from "~/server/services/auth";

type RestHandlerResult<TBody> =
	| Response
	| {
			body: TBody;
			init?: ResponseInit;
	  };

/** Verifies the request's bearer credential and returns a stable subject id. */
type Credential = (request: Request) => Promise<string>;

type RestQueryOptions<TBody> = {
	route: string;
	credential?: Credential;
	handler: (ctx: { request: Request }) => Promise<RestHandlerResult<TBody>>;
};

type RestMutationOptions<TSchema extends z.ZodTypeAny, TBody> = {
	route: string;
	credential?: Credential;
	input: TSchema;
	handler: (ctx: {
		input: z.infer<TSchema>;
		request: Request;
	}) => Promise<RestHandlerResult<TBody>>;
};

export function createRestQuery<TBody>(options: RestQueryOptions<TBody>) {
	return async function restQuery(request: Request) {
		return guard(request, async () => {
			const denied = await admit(request, options.route, options.credential);
			if (denied) return denied;
			return toResponse(request, await options.handler({ request }));
		});
	};
}

export function createRestMutation<TSchema extends z.ZodTypeAny, TBody>(
	options: RestMutationOptions<TSchema, TBody>,
) {
	return async function restMutation(request: Request) {
		return guard(request, async () => {
			const credentialed = hasCredential(request, options.credential);
			// Anonymous callers are limited before the body is read. Credentialed
			// callers are validated first so malformed input never reaches auth or DB.
			if (!credentialed) {
				const denied = await admit(request, options.route, undefined);
				if (denied) return denied;
			}
			const parsed = await parseBody(request, options.input);
			if (parsed instanceof Response)
				return credentialed
					? chargeAnonymous(request, options.route, parsed)
					: parsed;
			if (credentialed) {
				const denied = await admit(request, options.route, options.credential);
				if (denied) return denied;
			}
			return toResponse(
				request,
				await options.handler({ input: parsed.data, request }),
			);
		});
	};
}

async function parseBody<TSchema extends z.ZodTypeAny>(
	request: Request,
	schema: TSchema,
): Promise<{ data: z.infer<TSchema> } | Response> {
	let json: unknown;
	try {
		json = JSON.parse(await readRequestText(request));
	} catch (error) {
		return jsonError(
			request,
			"invalid_request",
			error instanceof BodyReadError ? error.message : "Invalid JSON body",
			error instanceof BodyReadError ? error.status : 400,
		);
	}
	const parsed = schema.safeParse(json);
	if (!parsed.success)
		return jsonError(
			request,
			"invalid_request",
			"Invalid request body",
			400,
			parsed.error.flatten(),
		);
	return { data: parsed.data };
}

async function guard(request: Request, run: () => Promise<Response>) {
	try {
		return await run();
	} catch (error) {
		return logAndReturnInternalError(request, error);
	}
}

function hasCredential(
	request: Request,
	credential: Credential | undefined,
): credential is Credential {
	return credential !== undefined && request.headers.has("authorization");
}

function rateLimited(
	request: Request,
	rateLimit: Awaited<ReturnType<typeof limitRequest>>,
) {
	return jsonError(request, "rate_limited", "Too many requests", 429, {
		limit: rateLimit.limit,
		remaining: rateLimit.remaining,
		reset: rateLimit.reset,
	});
}

/** Rejected credentialed requests still spend the per-IP anonymous quota. */
async function chargeAnonymous(
	request: Request,
	route: string,
	response: Response,
) {
	const rateLimit = await limitRequest(request, `${route}:anonymous`);
	return rateLimit.success ? response : rateLimited(request, rateLimit);
}

/**
 * Verified credentials get their own quota, so many clients behind one proxy
 * do not share a bucket. Returns a response when the request must stop.
 */
async function admit(
	request: Request,
	route: string,
	credential: Credential | undefined,
): Promise<Response | undefined> {
	if (!hasCredential(request, credential)) {
		const rateLimit = await limitRequest(request, route);
		return rateLimit.success ? undefined : rateLimited(request, rateLimit);
	}
	let subject: string;
	try {
		subject = await credential(request);
	} catch (error) {
		if (!(error instanceof AppError) || error.status !== 401) throw error;
		return chargeAnonymous(
			request,
			route,
			withCors(
				request,
				Response.json(
					{ error: { code: error.code, message: error.message } },
					{ status: 401, headers: { "Cache-Control": "no-store" } },
				),
			),
		);
	}
	const rateLimit = await limitCredential(route, subject);
	return rateLimit.success ? undefined : rateLimited(request, rateLimit);
}

function toResponse<TBody>(request: Request, result: RestHandlerResult<TBody>) {
	if (result instanceof Response) {
		return withCors(request, result);
	}

	return jsonOk(request, result.body, result.init);
}
