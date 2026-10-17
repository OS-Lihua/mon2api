import "server-only";
import { z } from "zod";
import {
	AppError,
	assertSameOrigin,
	logout,
	requireViewer,
	walletChallenge,
	walletLogin,
} from "~/server/services/auth";
import * as commerce from "~/server/services/commerce";
import * as contract from "~/server/services/commerce.schema";
import {
	authenticateKey,
	confirmSession,
	createKey,
	createListing,
	openSession,
	revokeKey,
	toggleListing,
	updateListing,
} from "~/server/services/market";
import {
	listingInput,
	listingUpdateInput,
	openSessionInput,
	sessionIdSchema,
} from "~/server/services/mon2api.schema";
import { refundStatus, requestRefund } from "~/server/services/refund";
import { closeSession, settleSession } from "~/server/services/settlement";
import type { Viewer } from "~/shared/mon2api";
import { createRestMutation, createRestQuery } from "./endpoint";

// Apply even to rate-limit, JSON parsing and validation errors from the shared wrapper.
function noStore(handler: (request: Request) => Promise<Response>) {
	return async (request: Request) => {
		const response = await handler(request);
		response.headers.set("Cache-Control", "no-store");
		response.headers.set("X-Content-Type-Options", "nosniff");
		return response;
	};
}
async function result<T extends z.ZodTypeAny>(
	schema: T,
	action: () => Promise<unknown>,
	status = 200,
) {
	try {
		return Response.json(schema.parse(await action()), { status });
	} catch (error) {
		if (!(error instanceof AppError)) throw error;
		return Response.json(
			{ error: { code: error.code, message: error.message } },
			{ status: error.status },
		);
	}
}
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
	const parsed = schema.safeParse(value);
	if (!parsed.success)
		throw new AppError("invalid_request", "路径或查询参数无效。", 400);
	return parsed.data;
}
function query<T extends z.ZodTypeAny>(
	schema: T,
	request: Request,
): z.infer<T> {
	const params = new URL(request.url).searchParams;
	const names = new Set<string>();
	for (const [key] of params) {
		if (names.has(key))
			throw new AppError("invalid_request", "查询参数不能重复。", 400);
		names.add(key);
	}
	return parse(schema, Object.fromEntries(params));
}
function rejectBearer(request: Request) {
	if (request.headers.has("authorization"))
		throw new AppError(
			"management_auth_required",
			"管理接口需要钱包登录 Cookie，不接受推理 API Key。",
			401,
		);
}
function publicQuery<T extends z.ZodTypeAny>(
	route: string,
	output: T,
	action: (request: Request) => Promise<unknown>,
) {
	return noStore(
		createRestQuery({
			route,
			handler: ({ request }) => result(output, () => action(request)),
		}),
	);
}
function managedQuery<T extends z.ZodTypeAny>(
	route: string,
	output: T,
	action: (user: Viewer, request: Request) => Promise<unknown>,
) {
	return publicQuery(route, output, async (request) => {
		rejectBearer(request);
		return action(await requireViewer(), request);
	});
}
function mutation<T extends z.ZodTypeAny, U extends z.ZodTypeAny>(options: {
	route: string;
	input: T;
	output: U;
	authenticated?: boolean;
	status?: number;
	action: (
		input: z.infer<T>,
		user: Viewer | null,
		request: Request,
	) => Promise<unknown>;
}) {
	return noStore(
		createRestMutation({
			route: options.route,
			input: options.input,
			handler: ({ input, request }) =>
				result(
					options.output,
					async () => {
						assertSameOrigin(request.headers);
						rejectBearer(request);
						const user =
							options.authenticated === false ? null : await requireViewer();
						return options.action(input, user, request);
					},
					options.status,
				),
		}),
	);
}
function signedIn(user: Viewer | null) {
	if (!user) throw new AppError("unauthorized", "请先完成钱包登录。", 401);
	return user;
}
const resourcePage = contract.pageResponse(contract.resourceResponse);
const sessionPage = contract.pageResponse(contract.sessionResponse);
const requestPage = contract.pageResponse(contract.requestResponse);
const settlementPage = contract.pageResponse(contract.settlementResponse);
export const networkGet = publicQuery(
	"commerce:network",
	contract.networkResponse,
	() => commerce.networkInfo(),
);
export const resourcesGet = publicQuery(
	"commerce:resources",
	resourcePage,
	(request) => commerce.listResources(query(contract.resourceQuery, request)),
);
export const resourceGet = (request: Request, id: string) =>
	publicQuery("commerce:resource", contract.resourceResponse, () =>
		commerce.getResource(parse(z.string().cuid(), id)),
	)(request);
export const meGet = managedQuery(
	"commerce:me",
	contract.viewerResponse,
	async (user) => user,
);
export const challengePost = mutation({
	route: "commerce:challenge",
	input: contract.walletChallengeInput,
	output: contract.challengeResponse,
	authenticated: false,
	action: (input) => walletChallenge(input.address),
});
export const loginPost = mutation({
	route: "commerce:login",
	input: contract.walletLoginInput,
	output: contract.viewerResponse,
	authenticated: false,
	action: (input) => walletLogin(input.address, input.message, input.signature),
});
export const logoutPost = mutation({
	route: "commerce:logout",
	input: contract.emptyInput,
	output: contract.okResponse,
	authenticated: false,
	action: async () => {
		await logout();
		return { ok: true };
	},
});
export const balancesGet = managedQuery(
	"commerce:balances",
	contract.balancesResponse,
	(user) => commerce.accountBalances(user),
);
export const merchantResourcesGet = managedQuery(
	"commerce:merchant-resources",
	resourcePage,
	(user, request) =>
		commerce.listResources(
			query(contract.resourceQuery, request),
			user.address,
		),
);
export const merchantResourceGet = (request: Request, id: string) =>
	managedQuery(
		"commerce:merchant-resource",
		contract.resourceResponse,
		(user) => commerce.getResource(parse(z.string().cuid(), id), user.address),
	)(request);
export const merchantResourcesPost = mutation({
	route: "commerce:create-resource",
	input: listingInput,
	output: contract.idResponse,
	status: 201,
	action: (input, user) => createListing(signedIn(user), input),
});
export const merchantResourcePost = (request: Request, id: string) =>
	mutation({
		route: "commerce:update-resource",
		input: listingUpdateInput,
		output: contract.okResponse,
		action: (input, user) =>
			updateListing(signedIn(user), parse(z.string().cuid(), id), input),
	})(request);
export const merchantStatusPost = (request: Request, id: string) =>
	mutation({
		route: "commerce:resource-status",
		input: contract.statusInput,
		output: contract.okResponse,
		action: (input, user) =>
			toggleListing(
				signedIn(user),
				parse(z.string().cuid(), id),
				input.enabled,
			),
	})(request);
export const consumerSessionsGet = managedQuery(
	"commerce:consumer-sessions",
	sessionPage,
	(user, request) =>
		commerce.listSessions(user, query(contract.pageQuery, request)),
);
export const consumerSessionsPost = mutation({
	route: "commerce:open-session",
	input: openSessionInput,
	output: contract.openSessionResponse,
	status: 201,
	action: (input, user) => openSession(signedIn(user), input),
});
export const consumerSessionGet = (request: Request, id: string) =>
	managedQuery("commerce:consumer-session", contract.sessionResponse, (user) =>
		commerce.getConsumerSession(user, parse(sessionIdSchema, id)),
	)(request);
export const confirmPost = (request: Request, id: string) =>
	mutation({
		route: "commerce:confirm-session",
		input: contract.confirmInput,
		output: contract.confirmedResponse,
		action: (input, user) =>
			confirmSession(
				signedIn(user),
				parse(sessionIdSchema, id),
				input.txHash,
				true,
			),
	})(request);
export const settlePost = (request: Request, id: string) =>
	mutation({
		route: "commerce:settle-session",
		input: contract.emptyInput,
		output: contract.transactionResponse,
		action: async (_input, user) => {
			const owner = signedIn(user);
			const sessionId = parse(sessionIdSchema, id);
			await commerce.getConsumerSession(owner, sessionId);
			return settleSession(sessionId, owner.address);
		},
	})(request);
export const closePost = (request: Request, id: string) =>
	mutation({
		route: "commerce:close-session",
		input: contract.emptyInput,
		output: contract.transactionResponse,
		action: (_input, user) =>
			closeSession(parse(sessionIdSchema, id), signedIn(user).address),
	})(request);
export const keysGet = managedQuery(
	"commerce:keys",
	contract.pageResponse(contract.keyResponse),
	(user, request) =>
		commerce.listKeys(user, query(contract.ledgerQuery, request)),
);
export const keysPost = mutation({
	route: "commerce:create-key",
	input: contract.createKeyInput,
	output: contract.keyCreatedResponse,
	status: 201,
	action: (input, user) =>
		createKey(signedIn(user), input.sessionId, input.name),
});
export const revokePost = (request: Request, id: string) =>
	mutation({
		route: "commerce:revoke-key",
		input: contract.emptyInput,
		output: contract.okResponse,
		action: (_input, user) =>
			revokeKey(signedIn(user), parse(z.string().cuid(), id)),
	})(request);
export const consumerRequestsGet = managedQuery(
	"commerce:consumer-requests",
	requestPage,
	(user, request) =>
		commerce.listRequests(
			user,
			"consumer",
			query(contract.requestQuery, request),
		),
);
export const merchantRequestsGet = managedQuery(
	"commerce:merchant-requests",
	requestPage,
	(user, request) =>
		commerce.listRequests(
			user,
			"provider",
			query(contract.ledgerQuery, request),
		),
);
export const consumerSettlementsGet = managedQuery(
	"commerce:consumer-settlements",
	settlementPage,
	(user, request) =>
		commerce.listSettlements(
			user,
			"consumer",
			query(contract.ledgerQuery, request),
		),
);
export const merchantSettlementsGet = managedQuery(
	"commerce:merchant-settlements",
	settlementPage,
	(user, request) =>
		commerce.listSettlements(
			user,
			"provider",
			query(contract.ledgerQuery, request),
		),
);
export const requestLookupGet = publicQuery(
	"commerce:request-lookup",
	contract.requestResponse,
	async (request) => {
		const key = await authenticateKey(request.headers.get("authorization"));
		return commerce.lookupRequest(
			key,
			query(contract.lookupQuery, request).idempotency_key,
		);
	},
);

export const refundPost = (request: Request, id: string) =>
	mutation({
		route: "commerce:request-refund",
		input: contract.emptyInput,
		output: contract.refundResponse,
		action: (_input, user) =>
			requestRefund(signedIn(user), parse(sessionIdSchema, id)),
	})(request);
export const refundGet = (request: Request, id: string) =>
	managedQuery("commerce:refund-status", contract.refundResponse, (user) =>
		refundStatus(user, parse(sessionIdSchema, id)),
	)(request);
