import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";

// This script intentionally has no configurable remote target or real signer.
const origin = "http://localhost:3000";
const hash = z.string().regex(/^0x[\da-fA-F]{64}$/);
const integer = z.number().int().nonnegative();
const snapshotSchema = z.object({
	viewer: z.object({ address: z.string(), demo: z.boolean() }).nullable(),
	network: z.object({
		mode: z.enum(["local", "evm"]),
		chainId: z.number().int(),
		rpcUrl: z.string().url(),
		ready: z.boolean(),
	}),
	metrics: z.object({
		claimable: z.string().regex(/^\d+$/).nullable(),
		walletBalance: z.string().regex(/^\d+$/).nullable(),
	}),
	listings: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			model: z.string(),
			owner: z.string(),
			kind: z.enum(["demo", "gateway"]),
			enabled: z.boolean(),
		}),
	),
	sessions: z.array(
		z.object({
			id: hash,
			budget: integer,
			spent: integer,
			reserved: integer,
			settled: integer,
			status: z.string(),
		}),
	),
	requests: z.array(
		z.object({
			id: z.string(),
			sessionId: hash,
			status: z.string(),
			inputTokens: integer,
			outputTokens: integer,
			cost: integer,
			usageSource: z.string(),
			settled: z.boolean(),
		}),
	),
	keys: z.array(
		z.object({ id: z.string(), sessionId: hash, revoked: z.boolean() }),
	),
	settlements: z.array(
		z.object({
			sessionId: hash,
			amount: integer,
			status: z.string(),
			txHash: hash.nullable(),
		}),
	),
});
type Snapshot = z.infer<typeof snapshotSchema>;

class SmokeFailure extends Error {}
function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new SmokeFailure(message);
}
let step = "local safety checks";
let cookie = "";
let consumerCookie = "";
let activeSessionId: string | null = null;
let checks = 0;
function pass(summary: string) {
	checks++;
	console.log(`PASS ${summary}`);
}

async function trpc<T extends z.ZodTypeAny>(
	name: string,
	input: unknown,
	schema: T,
	mutation = true,
): Promise<z.infer<T>> {
	const url = new URL(`/api/trpc/token2api.${name}`, origin);
	if (!mutation) url.searchParams.set("input", JSON.stringify({ json: input }));
	const response = await fetch(url, {
		method: mutation ? "POST" : "GET",
		headers: {
			"content-type": "application/json",
			origin,
			...(cookie ? { cookie } : {}),
		},
		body: mutation ? JSON.stringify({ json: input }) : undefined,
		redirect: "error",
		signal: AbortSignal.timeout(45_000),
	});
	for (const value of response.headers.getSetCookie()) {
		const pair = value.split(";", 1)[0];
		if (pair?.startsWith("token2api_session=")) cookie = pair;
	}
	check(response.ok, `tRPC ${name} returned HTTP ${response.status}.`);
	const payload: unknown = await response.json();
	const envelope = z
		.object({ result: z.object({ data: z.object({ json: z.unknown() }) }) })
		.parse(payload);
	return schema.parse(envelope.result.data.json);
}
async function snapshot(): Promise<Snapshot> {
	return trpc("snapshot", null, snapshotSchema, false);
}
function localOnly(value: Snapshot) {
	const rpc = new URL(value.network.rpcUrl);
	check(
		value.network.mode === "local" &&
			value.network.chainId === 31337 &&
			value.network.ready,
		"Refusing to run outside the ready local demo chain (31337).",
	);
	check(
		rpc.protocol === "http:" &&
			["127.0.0.1", "localhost", "[::1]"].includes(rpc.hostname),
		"Refusing a non-loopback chain RPC.",
	);
}
function lease(value: Snapshot, id: string) {
	const row = value.sessions.find((item) => item.id === id);
	check(row, "Smoke session was not returned by the API.");
	return row;
}

async function main() {
	check(
		!process.env.TOKEN2API_MODE || process.env.TOKEN2API_MODE === "local",
		"TOKEN2API_MODE must be local for this smoke script.",
	);
	localOnly(await snapshot());
	pass("target is loopback app + ready local demo chain");
	step = "consumer demo login";
	const identity = z.object({ address: z.string(), demo: z.literal(true) });
	await trpc("demoLogin", { role: "consumer" }, identity);
	consumerCookie = cookie;
	let state = await snapshot();
	localOnly(state);
	check(
		state.viewer?.demo,
		"Consumer must be an explicitly enabled demo identity.",
	);
	const listing = state.listings.find(
		(item) =>
			item.enabled && item.kind === "demo" && item.name.includes("Northstar"),
	);
	check(
		listing,
		"An enabled Northstar demo resource is required; the script will not change any listing.",
	);
	pass("consumer authenticated; selected enabled Northstar demo resource");

	step = "budget locking and key creation";
	const opened = await trpc(
		"openSession",
		{ listingId: listing.id, budget: 5_000_000 },
		z.object({ id: hash, mode: z.literal("demo"), txHash: hash }),
	);
	activeSessionId = opened.id;
	state = await snapshot();
	check(
		lease(state, opened.id).status === "ACTIVE" &&
			lease(state, opened.id).budget === 5_000_000,
		"Demo budget did not become active.",
	);
	const { key } = await trpc(
		"createKey",
		{ sessionId: opened.id, name: "local-e2e-smoke" },
		z.object({ key: z.string().regex(/^m2a_[\w-]{43}$/) }),
	);
	const sdk = new OpenAI({
		apiKey: key,
		baseURL: `${origin}/v1`,
		maxRetries: 0,
		timeout: 45_000,
		fetchOptions: { redirect: "error" },
	});
	const models = await sdk.models.list();
	check(
		models.data.length === 1 && models.data[0]?.id === listing.model,
		"Key must expose only its session model.",
	);
	pass(`budget locked; scoped platform key created; open tx ${opened.txHash}`);

	step = "non-stream chat and idempotency";
	const idempotencyKey = randomUUID();
	const body = {
		model: listing.model,
		max_tokens: 256,
		messages: [
			{ role: "user" as const, content: "Local demo end-to-end smoke." },
		],
	};
	const response = await sdk.chat.completions.create(body, {
		headers: { "Idempotency-Key": idempotencyKey },
	});
	check(
		response.choices[0]?.message.content?.includes("SIMULATED DEMO"),
		"Response must be explicitly simulated.",
	);
	check(
		response.usage &&
			response.usage.prompt_tokens > 0 &&
			response.usage.completion_tokens > 0,
		"Non-stream usage is missing.",
	);
	const metadata = z
		.object({
			token2api: z.object({
				request_id: z.string(),
				usage_source: z.literal("demo"),
				cost: integer.positive(),
			}),
		})
		.parse(response);
	const beforeReplay = await snapshot();
	const sessionRequests = beforeReplay.requests.filter(
		(item) => item.sessionId === opened.id,
	);
	check(
		sessionRequests.length === 1 &&
			sessionRequests[0]?.id === metadata.token2api.request_id,
		"Non-stream request did not create exactly one matching bill.",
	);
	let duplicateStatus: number | undefined;
	try {
		await sdk.chat.completions.create(body, {
			headers: { "Idempotency-Key": idempotencyKey },
		});
	} catch (error) {
		if (error instanceof OpenAI.APIError) duplicateStatus = error.status;
		else throw error;
	}
	check(
		duplicateStatus === 409,
		"A repeated Idempotency-Key must return HTTP 409.",
	);
	const afterReplay = await snapshot();
	check(
		afterReplay.requests.filter((item) => item.sessionId === opened.id)
			.length === 1,
		"Replaying a request created another bill.",
	);
	check(
		lease(afterReplay, opened.id).spent ===
			lease(beforeReplay, opened.id).spent,
		"Replaying a request changed the charge.",
	);
	pass(
		`non-stream usage + replay protection; request ${metadata.token2api.request_id}`,
	);

	step = "stream chat and final usage";
	const stream = await sdk.chat.completions.create(
		{ ...body, stream: true, stream_options: { include_usage: true } },
		{ headers: { "Idempotency-Key": randomUUID() } },
	);
	let streamText = "";
	let streamUsage = false;
	let streamFinished = false;
	for await (const chunk of stream) {
		streamText += chunk.choices[0]?.delta.content ?? "";
		if (chunk.choices[0]?.finish_reason === "stop") streamFinished = true;
		if (
			chunk.usage &&
			chunk.usage.prompt_tokens > 0 &&
			chunk.usage.completion_tokens > 0
		)
			streamUsage = true;
	}
	check(
		streamText.includes("SIMULATED DEMO") && streamFinished && streamUsage,
		"Stream requires simulated text, stop and final usage.",
	);
	state = await snapshot();
	const bills = state.requests.filter((item) => item.sessionId === opened.id);
	check(
		bills.length === 2 &&
			bills.every(
				(item) =>
					item.status === "COMPLETED" &&
					item.usageSource === "demo" &&
					item.cost > 0,
			),
		"Two completed demo bills were not captured.",
	);
	check(
		lease(state, opened.id).reserved === 0,
		"Completed calls left reserved budget.",
	);
	const spent = bills.reduce((sum, item) => sum + item.cost, 0);
	check(
		lease(state, opened.id).spent === spent,
		"Session total does not match its bills.",
	);
	pass(
		`stream final usage captured; ${bills.length} bills reconcile to ${spent} micro dUSD`,
	);

	step = "settlement and replay";
	const txResult = z.object({ txHash: hash.nullable() });
	for (let attempt = 0; attempt < bills.length; attempt++) {
		state = await snapshot();
		if (lease(state, opened.id).settled === spent) break;
		await trpc("settle", { sessionId: opened.id }, txResult);
	}
	state = await snapshot();
	check(
		lease(state, opened.id).settled === spent,
		"Settled amount does not match usage bills.",
	);
	check(
		state.requests
			.filter((item) => item.sessionId === opened.id)
			.every((item) => item.settled),
		"Bills did not become settled.",
	);
	const confirmed = state.settlements.filter(
		(item) => item.sessionId === opened.id,
	);
	check(
		confirmed.length > 0 &&
			confirmed.every(
				(item) => item.status === "CONFIRMED" && item.txHash !== null,
			) &&
			confirmed.reduce((sum, item) => sum + item.amount, 0) === spent,
		"Confirmed settlement transactions do not reconcile to usage bills.",
	);
	const replaySettlement = await trpc(
		"settle",
		{ sessionId: opened.id },
		txResult,
	);
	const afterReplaySettlement = await snapshot();
	check(
		replaySettlement.txHash === null &&
			lease(afterReplaySettlement, opened.id).settled === spent,
		"Repeated settlement changed the amount.",
	);
	check(
		afterReplaySettlement.settlements.filter(
			(item) => item.sessionId === opened.id,
		).length === confirmed.length,
		"Repeated settlement created another batch.",
	);
	state = afterReplaySettlement;
	pass(
		`chain settlement + replay protection; ${confirmed.length} confirmed batch(es), tx ${confirmed.map((item) => item.txHash).join(", ")}`,
	);

	step = "close, refund and key revocation";
	const beforeCloseClaimable = state.metrics.claimable;
	check(
		beforeCloseClaimable !== null,
		"Consumer balance could not be read before close.",
	);
	const closed = await trpc("closeSession", { sessionId: opened.id }, txResult);
	state = await snapshot();
	check(
		closed.txHash && lease(state, opened.id).status === "CLOSED",
		"Session did not close.",
	);
	activeSessionId = null;
	const refund = 5_000_000 - spent;
	check(
		state.metrics.claimable !== null,
		"Consumer refund balance could not be read.",
	);
	check(
		BigInt(state.metrics.claimable) >=
			BigInt(beforeCloseClaimable) + BigInt(refund),
		"Unused budget did not become a consumer refund.",
	);
	const accessKey = state.keys.find((item) => item.sessionId === opened.id);
	check(accessKey?.revoked, "Closing the session must revoke its key.");
	await trpc(
		"revokeKey",
		{ id: accessKey.id },
		z.object({ ok: z.literal(true) }),
	);
	const deniedModels = await fetch(`${origin}/v1/models`, {
		headers: { authorization: `Bearer ${key}` },
		redirect: "error",
		signal: AbortSignal.timeout(10_000),
	});
	check(
		deniedModels.status === 401,
		"Revoked key must receive HTTP 401 from /v1/models.",
	);
	pass(
		`unused budget refunded (${refund} micro dUSD); key revoked; close tx ${closed.txHash}`,
	);

	step = "provider withdrawal";
	await trpc("demoLogin", { role: "provider" }, identity);
	const providerBefore = await snapshot();
	check(
		providerBefore.viewer?.address.toLowerCase() ===
			listing.owner.toLowerCase(),
		"Northstar must belong to the demo provider.",
	);
	check(
		providerBefore.metrics.claimable !== null &&
			BigInt(providerBefore.metrics.claimable) > 0n &&
			providerBefore.metrics.walletBalance !== null,
		"Provider balance or settlement revenue could not be read.",
	);
	const withdrawal = await trpc(
		"withdraw",
		null,
		z.object({ mode: z.literal("demo"), txHash: hash }),
	);
	const providerAfter = await snapshot();
	check(
		providerAfter.metrics.walletBalance !== null,
		"Provider balance could not be read after withdrawal.",
	);
	check(
		BigInt(providerAfter.metrics.walletBalance) >=
			BigInt(providerBefore.metrics.walletBalance) +
				BigInt(providerBefore.metrics.claimable),
		"Provider wallet did not receive claimable revenue.",
	);
	pass(
		`provider wallet received settlement income; withdrawal tx ${withdrawal.txHash}`,
	);
	console.log(
		`PASS ${checks} checks; local demo end-to-end flow complete. No real upstream or testnet transactions were used.`,
	);
}

main().catch(async (error: unknown) => {
	// Do not print SDK errors, payloads, cookies, keys, or response bodies.
	const detail =
		error instanceof SmokeFailure
			? error.message
			: error instanceof OpenAI.APIError
				? `API returned HTTP ${error.status ?? "unknown"}.`
				: error instanceof z.ZodError
					? "Response schema did not match the expected local API."
					: "Unexpected transport or execution failure.";
	console.error(`FAIL ${step}: ${detail}`);
	if (activeSessionId && consumerCookie) {
		cookie = consumerCookie;
		try {
			const cleanup = await trpc(
				"closeSession",
				{ sessionId: activeSessionId },
				z.object({ txHash: hash.nullable() }),
			);
			console.log(
				`CLEANUP smoke session closed; tx ${cleanup.txHash ?? "already closed"}`,
			);
		} catch {
			console.error(
				"CLEANUP smoke session needs manual review; no unknown usage was discarded.",
			);
		}
	}
	process.exitCode = 1;
});
