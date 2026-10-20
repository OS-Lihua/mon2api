import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import * as c from "~/server/services/commerce.schema";
import {
	listingInput,
	listingUpdateInput,
	openSessionInput,
	sessionIdSchema,
} from "~/server/services/token2api.schema";

type Operation = {
	method: "get" | "post";
	path: string;
	operationId: string;
	summary: string;
	tag: string;
	auth: "public" | "wallet" | "key";
	output: z.ZodTypeAny;
	input?: z.ZodTypeAny;
	query?: z.AnyZodObject;
	id?: z.ZodTypeAny;
	created?: boolean;
	description?: string;
};
export function registerCommerce(
	registry: OpenAPIRegistry,
	error: z.ZodTypeAny,
) {
	registry.registerComponent("securitySchemes", "walletSession", {
		type: "apiKey",
		in: "cookie",
		name: "token2api_session",
		description:
			"Eight-hour wallet sign-in session. Never use an inference API key for management. Browser POST origins must match APP_ORIGIN; CLI clients may omit Origin.",
	});
	const resource = registry.register("Resource", c.resourceResponse);
	const resources = registry.register("ResourcePage", c.pageResponse(resource));
	const session = registry.register("ConsumerSession", c.sessionResponse);
	const sessions = registry.register("SessionPage", c.pageResponse(session));
	const usage = registry.register("MeteredRequest", c.requestResponse);
	const requests = registry.register("RequestPage", c.pageResponse(usage));
	const keys = registry.register("KeyPage", c.pageResponse(c.keyResponse));
	const settlements = registry.register(
		"SettlementPage",
		c.pageResponse(c.settlementResponse),
	);
	const network = registry.register("Network", c.networkResponse);
	const balances = registry.register("AccountBalances", c.balancesResponse);
	const viewer = registry.register("WalletViewer", c.viewerResponse);
	const newResource = registry.register("CreateResource", listingInput);
	const updateResource = registry.register(
		"UpdateResource",
		listingUpdateInput,
	);
	const newSession = registry.register("OpenSession", openSessionInput);
	const opened = registry.register("OpenedSession", c.openSessionResponse);
	const ok = registry.register("Ok", c.okResponse);
	const operations: Operation[] = [
		{
			method: "get",
			path: "/network",
			operationId: "getNetwork",
			summary: "Get public chain and contract information",
			tag: "Discovery",
			auth: "public",
			output: network,
		},
		{
			method: "get",
			path: "/resources",
			operationId: "listResources",
			summary: "Search enabled resources",
			tag: "Discovery",
			auth: "public",
			output: resources,
			query: c.resourceQuery,
		},
		{
			method: "get",
			path: "/resources/{id}",
			operationId: "getResource",
			summary: "Read an enabled resource without connector secrets",
			tag: "Discovery",
			auth: "public",
			output: resource,
			id: z.string().cuid(),
		},
		{
			method: "post",
			path: "/auth/challenge",
			operationId: "createWalletChallenge",
			summary: "Create a five-minute single-use SIWE challenge",
			tag: "Authentication",
			auth: "public",
			input: c.walletChallengeInput,
			output: c.challengeResponse,
		},
		{
			method: "post",
			path: "/auth/login",
			operationId: "loginWallet",
			summary: "Verify SIWE signature and set wallet session cookie",
			tag: "Authentication",
			auth: "public",
			input: c.walletLoginInput,
			output: viewer,
		},
		{
			method: "get",
			path: "/auth/me",
			operationId: "getWalletViewer",
			summary: "Read the signed-in wallet",
			tag: "Authentication",
			auth: "wallet",
			output: viewer,
		},
		{
			method: "post",
			path: "/auth/logout",
			operationId: "logoutWallet",
			summary: "Destroy the wallet session cookie",
			tag: "Authentication",
			auth: "public",
			input: c.emptyInput,
			output: ok,
		},
		{
			method: "get",
			path: "/account/balances",
			operationId: "getAccountBalances",
			summary: "Read wallet and claimable balances as exact integer strings",
			tag: "Account",
			auth: "wallet",
			output: balances,
			description:
				"Native balances use wei (18 decimals); USDT/USDC balances use atomic token units with network.tokenDecimals. Check unit and network asset. 503 means unavailable; never infer zero. Withdrawal is a separate consumer-signed contract withdraw() transaction.",
		},
		{
			method: "get",
			path: "/merchant/resources",
			operationId: "listMerchantResources",
			summary: "List this wallet's resources, including paused resources",
			tag: "Merchant",
			auth: "wallet",
			output: resources,
			query: c.resourceQuery,
		},
		{
			method: "post",
			path: "/merchant/resources",
			operationId: "createMerchantResource",
			summary: "Publish a resource owned by the signed-in wallet",
			tag: "Merchant",
			auth: "wallet",
			input: newResource,
			output: c.idResponse,
			created: true,
			description:
				"Gateway origin must be operator-approved and support OpenAI Chat Completions with usage. baseUrl may include a custom API base path; a bare origin defaults to /v1. Discovery and inference use the same base path. Gateway credentials are encrypted and never returned. Demo resources are local-only. Creation is not replay-safe: do not automatically retry.",
		},
		{
			method: "get",
			path: "/merchant/resources/{id}",
			operationId: "getMerchantResource",
			summary: "Read this wallet's resource, including paused resources",
			tag: "Merchant",
			auth: "wallet",
			id: z.string().cuid(),
			output: resource,
		},
		{
			method: "post",
			path: "/merchant/resources/{id}",
			operationId: "updateMerchantResource",
			summary: "Update metadata, price or concurrency of an owned resource",
			tag: "Merchant",
			auth: "wallet",
			id: z.string().cuid(),
			input: updateResource,
			output: ok,
			description:
				"At least one field is required. New prices apply only to future sessions; existing price snapshots remain unchanged. Model, kind and connector credentials are immutable. Pause and publish a new resource to replace a connector.",
		},
		{
			method: "post",
			path: "/merchant/resources/{id}/status",
			operationId: "setMerchantResourceStatus",
			summary: "Enable or pause an owned resource",
			tag: "Merchant",
			auth: "wallet",
			id: z.string().cuid(),
			input: c.statusInput,
			output: ok,
		},
		{
			method: "get",
			path: "/merchant/requests",
			operationId: "listMerchantRequests",
			summary: "List metered requests belonging to this provider",
			tag: "Merchant",
			auth: "wallet",
			query: c.ledgerQuery,
			output: requests,
		},
		{
			method: "get",
			path: "/merchant/settlements",
			operationId: "listMerchantSettlements",
			summary: "List settlement batches belonging to this provider",
			tag: "Merchant",
			auth: "wallet",
			query: c.ledgerQuery,
			output: settlements,
			description:
				"Amounts are gross settlement increments, not provider net earnings; feeBps is applied cumulatively on chain. READY is not confirmed income.",
		},
		{
			method: "get",
			path: "/consumer/sessions",
			operationId: "listConsumerSessions",
			summary: "List sessions purchased by this wallet",
			tag: "Consumer",
			auth: "wallet",
			query: c.pageQuery,
			output: sessions,
		},
		{
			method: "post",
			path: "/consumer/sessions",
			operationId: "openConsumerSession",
			summary: "Prepare a fixed-price prepaid session",
			tag: "Consumer",
			auth: "wallet",
			input: newSession,
			output: opened,
			created: true,
			description:
				"Wallet mode creates a DRAFT only. Sign token approve and escrow openSession with the returned terms, then POST confirm. Demo mode submits local-only transactions. Do not automatically retry creation.",
		},
		{
			method: "get",
			path: "/consumer/sessions/{id}",
			operationId: "getConsumerSession",
			summary: "Read a purchased session and its budget reservation",
			tag: "Consumer",
			auth: "wallet",
			id: sessionIdSchema,
			output: session,
		},
		{
			method: "post",
			path: "/consumer/sessions/{id}/confirm",
			operationId: "confirmConsumerSession",
			summary: "Activate a session after verifying the on-chain opening event",
			tag: "Consumer",
			auth: "wallet",
			id: sessionIdSchema,
			input: c.confirmInput,
			output: c.confirmedResponse,
			description:
				"txHash is optional; without it the service scans the matching opening event. Requires the configured confirmation count and matching terms. The first activation atomically returns connection {base_url,key,model}; the full key is shown once and only its hash is stored. Repeated confirmation does not issue another key. If the response is lost, create a replacement via /consumer/keys and revoke the lost initial key.",
		},
		{
			method: "post",
			path: "/consumer/sessions/{id}/settle",
			operationId: "settleConsumerSession",
			summary: "Settle earned usage through the persisted settlement queue",
			tag: "Consumer",
			auth: "wallet",
			id: sessionIdSchema,
			input: c.emptyInput,
			output: c.transactionResponse,
		},
		{
			method: "post",
			path: "/consumer/sessions/{id}/close",
			operationId: "closeConsumerSession",
			summary: "Stop admission, settle and release unused budget",
			tag: "Consumer",
			auth: "wallet",
			id: sessionIdSchema,
			input: c.emptyInput,
			output: c.transactionResponse,
			description:
				"409 pending_requests stops admission but retains reservations until running/review requests are resolved. Closing does not withdraw the resulting claimable balance.",
		},
		{
			method: "post",
			path: "/consumer/sessions/{id}/refund",
			operationId: "requestUnusedBudgetRefund",
			summary: "Request release of unused native asset budget",
			tag: "Consumer",
			auth: "wallet",
			id: sessionIdSchema,
			input: c.emptyInput,
			output: c.refundResponse,
			description:
				"Idempotent application recorded in the ledger; stops new calls immediately. PROCESSING/PENDING_REVIEW retains running/unknown usage reservations; the settlement worker resumes closure. amount is currently unreserved budget while pending, and the confirmed refund when AVAILABLE. AVAILABLE means credited to the original consumer's claimable balance, not a wallet transfer. withdrawRequired instructs the consumer to sign escrow.withdraw(); claimable balances can combine multiple refunds and earnings. Already consumed usage and gas are not refunded.",
		},
		{
			method: "get",
			path: "/consumer/sessions/{id}/refund",
			operationId: "getUnusedBudgetRefund",
			summary: "Read an owned refund application's status",
			tag: "Consumer",
			auth: "wallet",
			id: sessionIdSchema,
			output: c.refundResponse,
		},
		{
			method: "get",
			path: "/consumer/keys",
			operationId: "listConsumerKeys",
			summary: "List owned key metadata without hashes or full keys",
			tag: "Consumer",
			auth: "wallet",
			query: c.ledgerQuery,
			output: keys,
		},
		{
			method: "post",
			path: "/consumer/keys",
			operationId: "createConsumerKey",
			summary: "Create an inference key for an owned active session",
			tag: "Consumer",
			auth: "wallet",
			input: c.createKeyInput,
			output: c.buyerConnectionResponse,
			created: true,
			description:
				"Full key is returned once. Store it server-side. This operation is not replay-safe.",
		},
		{
			method: "post",
			path: "/consumer/keys/{id}/revoke",
			operationId: "revokeConsumerKey",
			summary: "Revoke an owned inference key",
			tag: "Consumer",
			auth: "wallet",
			id: z.string().cuid(),
			input: c.emptyInput,
			output: ok,
		},
		{
			method: "get",
			path: "/consumer/requests",
			operationId: "listConsumerRequests",
			summary: "List this consumer's metered requests",
			tag: "Consumer",
			auth: "wallet",
			query: c.requestQuery,
			output: requests,
		},
		{
			method: "get",
			path: "/consumer/settlements",
			operationId: "listConsumerSettlements",
			summary: "List settlement batches for this consumer",
			tag: "Consumer",
			auth: "wallet",
			query: c.ledgerQuery,
			output: settlements,
		},
		{
			method: "get",
			path: "/requests/lookup",
			operationId: "lookupMeteredRequest",
			summary:
				"Look up a request by stable idempotency key using the inference key",
			tag: "Inference",
			auth: "key",
			query: c.lookupQuery,
			output: usage,
			description:
				"Read-only and scoped to the API key's own session and consumer. Returns usage status, not completion text. REVIEW and null tokens mean unknown usage with a retained reservation. A 404 is not proof that an in-flight request was never accepted. Never retry lost paid work under a new key.",
		},
	];
	for (const op of operations) {
		registry.registerPath({
			method: op.method,
			path: op.path,
			operationId: op.operationId,
			summary: op.summary,
			tags: [op.tag],
			servers: [{ url: "/api/v1" }],
			security:
				op.auth === "public"
					? []
					: op.auth === "wallet"
						? [{ walletSession: [] }]
						: [{ bearerAuth: [] }],
			description: [
				op.description,
				"Billing amounts/prices are integer millionths of the configured asset (network.ledgerUnit=micro_<asset>); rates are per million tokens. Chain amounts equal billing amounts times 10^(network.tokenDecimals-6). Native assets require msg.value; USDT/USDC require ERC20 approval. Each isolated deployment fixes one chain, asset, token precision and escrow. Raw balances have their own unit. List endpoints are newest-first by createdAt then id, use limit (1..100, default 20) and nextCursor; each page is a live view, not an immutable snapshot. All responses are no-store. Unknown or duplicate query parameters are rejected. POST bodies must be JSON, including {} for empty actions.",
			]
				.filter(Boolean)
				.join(" "),
			request: {
				...(op.input
					? {
							body: {
								required: true,
								content: { "application/json": { schema: op.input } },
							},
						}
					: {}),
				...(op.query ? { query: op.query } : {}),
				...(op.id ? { params: z.object({ id: op.id }) } : {}),
			},
			responses: {
				[op.created ? 201 : 200]: {
					description: "Success",
					content: { "application/json": { schema: op.output } },
				},
				...Object.fromEntries(
					[400, 401, 402, 403, 404, 408, 409, 413, 429, 500, 503].map(
						(status) => [
							status,
							{
								description: {
									400: "Invalid input",
									401: "Authentication required or wrong credential type",
									402: "Insufficient budget",
									403: "Origin or demo restriction",
									404: "Not found or not owned",
									408: "Body read deadline exceeded",
									409: "State conflict or pending review",
									413: "Body too large",
									429: "Rate limited",
									500: "Unexpected server error",
									503: "Chain unavailable",
								}[status],
								content: { "application/json": { schema: error } },
							},
						],
					),
				),
			},
		});
	}
}
