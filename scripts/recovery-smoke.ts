import "dotenv/config";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createPublicClient, getAddress, type Hex, http } from "viem";
import { z } from "zod";
import { escrowAbi } from "../src/lib/abi";
import {
	SETTLEMENT_ASSETS,
	toChainAmount,
} from "../src/shared/settlement-asset";

/**
 * Explicit local fault injection, never part of the ordinary unit test suite.
 * Run against an already running local app, database and persistent local EVM:
 * TOKEN2API_RECOVERY_TEST=true ALLOW_DEMO=true TOKEN2API_MODE=local \
 *   node --import tsx scripts/recovery-smoke.ts
 * Only the newly created test session and its own settlement ledger are changed.
 */
const origin = "http://localhost:3000";
const hash = z.string().regex(/^0x[\da-fA-F]{64}$/);
const address = z.string().regex(/^0x[\da-fA-F]{40}$/);
const configSchema = z.object({
	asset: z.enum(SETTLEMENT_ASSETS),
	tokenDecimals: z.number().int().min(6).max(18).optional(),
	mode: z.literal("local"),
	chainId: z.literal(31337),
	rpcUrl: z.string().url(),
	token: address,
	escrow: address,
});
const snapshotSchema = z.object({
	viewer: z.object({ address, demo: z.boolean() }).nullable(),
	network: configSchema.extend({ ready: z.literal(true) }),
	listings: z.array(
		z.object({
			id: z.string(),
			enabled: z.boolean(),
			kind: z.enum(["demo", "gateway"]),
		}),
	),
});
const txSchema = z.object({ txHash: hash.nullable() });
class RecoveryFailure extends Error {}
function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new RecoveryFailure(message);
}
let cookie = "";
let step = "local safety checks";
let testSessionId: string | null = null;
let db: PrismaClient | undefined;

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
	check(response.ok, `Local HTTP ${name} returned status ${response.status}.`);
	const payload: unknown = await response.json();
	const envelope = z
		.object({ result: z.object({ data: z.object({ json: z.unknown() }) }) })
		.parse(payload);
	return schema.parse(envelope.result.data.json);
}

async function scenario(withLaterUsage: boolean) {
	check(
		process.env.TOKEN2API_RECOVERY_TEST === "true",
		"Set TOKEN2API_RECOVERY_TEST=true to explicitly authorize local fault injection.",
	);
	check(
		process.env.ALLOW_DEMO === "true" && process.env.TOKEN2API_MODE === "local",
		"Fault injection requires ALLOW_DEMO=true and TOKEN2API_MODE=local.",
	);
	check(
		!process.env.CHAIN_CONFIG_JSON,
		"Use the local chain.json file rather than CHAIN_CONFIG_JSON for this test.",
	);
	const directory = path.resolve(process.env.TOKEN2API_DATA_DIR || ".runtime");
	const config = configSchema.parse(
		JSON.parse(fs.readFileSync(path.join(directory, "chain.json"), "utf8")),
	);
	const rpc = new URL(config.rpcUrl);
	check(
		rpc.protocol === "http:" &&
			["localhost", "127.0.0.1"].includes(rpc.hostname) &&
			!rpc.username &&
			!rpc.password,
		"Fault injection refuses a non-loopback local EVM RPC.",
	);
	const client = createPublicClient({ transport: http(config.rpcUrl) });
	check(
		(await client.getChainId()) === 31337,
		"Fault injection refuses any chain other than local 31337.",
	);
	const state = await trpc(
		"snapshot",
		{ gatewayOnly: false },
		snapshotSchema,
		false,
	);
	check(
		getAddress(state.network.token) === getAddress(config.token) &&
			getAddress(state.network.escrow) === getAddress(config.escrow),
		"The app and test script must use the exact same local deployment.",
	);
	const user = await trpc(
		"demoLogin",
		{ role: "consumer" },
		z.object({ address, demo: z.literal(true) }),
	);
	const listing = state.listings.find(
		(item) => item.enabled && item.kind === "demo",
	);
	check(listing, "An enabled local demo resource is required.");
	db ??= new PrismaClient();
	const binding = await db.chainBinding.findUnique({ where: { id: "active" } });
	check(
		binding?.chainId === 31337 &&
			binding.escrow === config.escrow.toLowerCase() &&
			binding.token === config.token.toLowerCase(),
		"Database must be bound to this exact local deployment.",
	);

	step = "create and settle a new isolated test session";
	const opened = await trpc(
		"openSession",
		{ listingId: listing.id, budget: 1_000_000 },
		z.object({ id: hash, mode: z.literal("demo") }),
	);
	testSessionId = opened.id;
	await trpc(
		"chat",
		{
			sessionId: opened.id,
			messages: [{ role: "user", content: "Local settlement recovery check." }],
			maxTokens: 128,
			conversationId: randomUUID(),
			idempotencyKey: randomUUID(),
		},
		z.object({
			cost: z.number().int().positive(),
			usageSource: z.literal("demo"),
		}),
	);
	await trpc("settle", { sessionId: opened.id }, txSchema);
	const session = await db.lease.findUniqueOrThrow({
		where: { id: opened.id },
	});
	const jobs = await db.settlement.findMany({
		where: { sessionId: opened.id },
	});
	const job = jobs[0];
	check(
		jobs.length === 1 &&
			job?.status === "CONFIRMED" &&
			job.txHash &&
			job.nonce === 0,
		"Test session requires exactly one confirmed first settlement.",
	);
	check(
		session.consumer === user.address &&
			session.budget === 1_000_000n &&
			session.reserved === 0n &&
			session.spent === job.cumulative &&
			session.settled === job.cumulative,
		"The isolated test session did not reconcile before fault injection.",
	);
	const readChain = () =>
		client.readContract({
			address: getAddress(config.escrow),
			abi: escrowAbi,
			functionName: "sessions",
			args: [opened.id as Hex],
		});
	const originalChain = await readChain();
	check(
		originalChain[4] ===
			toChainAmount(job.cumulative, config.asset, config.tokenDecimals) &&
			originalChain[5] === 1n &&
			!originalChain[8],
		"The original settlement was not confirmed on the local EVM.",
	);
	console.log(`PASS isolated local session settled; session ${opened.id}`);
	let expectedSpent = session.spent;
	if (withLaterUsage) {
		step = "complete a later request while the first batch is already on-chain";
		const later = await trpc(
			"chat",
			{
				sessionId: opened.id,
				messages: [
					{
						role: "user",
						content: "Second local call for close drain regression.",
					},
				],
				maxTokens: 128,
				conversationId: randomUUID(),
				idempotencyKey: randomUUID(),
			},
			z.object({
				cost: z.number().int().positive(),
				usageSource: z.literal("demo"),
			}),
		);
		expectedSpent += BigInt(later.cost);
	}

	step = "inject loss of the database confirmation transaction";
	await db.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${opened.id}))`;
		const current = await tx.settlement.findUniqueOrThrow({
			where: { id: job.id },
		});
		check(
			current.sessionId === opened.id && current.status === "CONFIRMED",
			"Test settlement changed before fault injection.",
		);
		if (withLaterUsage) {
			const batches = await tx.settlement.count({
				where: { sessionId: opened.id },
			});
			const pending = await tx.meterRequest.count({
				where: {
					sessionId: opened.id,
					status: "COMPLETED",
					settlementId: null,
				},
			});
			const latestSession = await tx.lease.findUniqueOrThrow({
				where: { id: opened.id },
			});
			check(
				batches === 1 && pending === 1 && latestSession.spent === expectedSpent,
				"Background worker settled the later bill before injection; rerun this isolated test.",
			);
		}
		// Confirmation, settled total and SETTLE ledger entry share one transaction.
		// Remove only this test session's entry to model that entire commit being lost.
		const removed = await tx.ledgerEntry.deleteMany({
			where: { sessionId: opened.id, kind: "SETTLE", amount: job.amount },
		});
		check(
			removed.count === 1,
			"Expected exactly one test-session settlement ledger entry.",
		);
		await tx.settlement.update({
			where: { id: job.id },
			data: { status: "READY", txHash: null },
		});
		await tx.lease.update({
			where: { id: opened.id },
			data: { settled: job.cumulative - job.amount },
		});
	});
	console.log(
		"PASS local confirmation loss injected only into the new test session",
	);

	const claimable = () =>
		client.readContract({
			address: getAddress(config.escrow),
			abi: escrowAbi,
			functionName: "claimable",
			args: [getAddress(user.address)],
		});
	const beforeRefund = await claimable();
	step = withLaterUsage
		? "close while recovering an old batch and draining a later bill"
		: "recover the confirmed on-chain batch through HTTP";
	await trpc(
		withLaterUsage ? "closeSession" : "settle",
		{ sessionId: opened.id },
		txSchema,
	);
	const afterChain = await readChain();
	check(
		afterChain[4] ===
			toChainAmount(expectedSpent, config.asset, config.tokenDecimals) &&
			afterChain[5] === (withLaterUsage ? 2n : originalChain[5]),
		"Recovery must charge each bill exactly once and preserve the original batch nonce.",
	);
	const recoveredJob = await db.settlement.findUniqueOrThrow({
		where: { id: job.id },
	});
	const recoveredSession = await db.lease.findUniqueOrThrow({
		where: { id: opened.id },
	});
	const ledgerCount = await db.ledgerEntry.count({
		where: { sessionId: opened.id, kind: "SETTLE" },
	});
	check(
		recoveredJob.status === "CONFIRMED" &&
			recoveredJob.txHash === job.txHash &&
			recoveredSession.settled === expectedSpent &&
			ledgerCount === (withLaterUsage ? 2 : 1),
		"Recovery did not restore the original confirmation, transaction hash and settled ledger exactly once.",
	);
	if (withLaterUsage) {
		const batches = await db.settlement.findMany({
			where: { sessionId: opened.id },
			orderBy: { nonce: "asc" },
		});
		check(
			batches.length === 2 &&
				batches.every((batch) => batch.status === "CONFIRMED") &&
				batches[1]?.nonce === 1 &&
				batches[1].cumulative === expectedSpent &&
				batches.reduce((total, batch) => total + batch.amount, 0n) ===
					expectedSpent,
			"Close did not confirm both the recovered batch and the later usage batch.",
		);
		console.log(
			"PASS close recovered the first batch and drained the later bill; chain nonce is exactly two",
		);
	} else {
		console.log(
			"PASS durable outbox recovered the original event without changing chain nonce or spent",
		);
	}

	step = "close the recovered session and release its refund";
	if (!withLaterUsage)
		await trpc("closeSession", { sessionId: opened.id }, txSchema);
	check(
		(await readChain())[8],
		"Recovered test session did not close on-chain.",
	);
	check(
		(await claimable()) >=
			beforeRefund +
				toChainAmount(
					session.budget - expectedSpent,
					config.asset,
					config.tokenDecimals,
				),
		"Recovered test session did not release its unused budget to the consumer.",
	);
	check(
		(await db.lease.findUniqueOrThrow({ where: { id: opened.id } })).status ===
			"CLOSED",
		"Recovered test session did not close in the database.",
	);
	testSessionId = null;
	console.log(
		"PASS recovered session closed with the correct unused-budget refund",
	);
}

async function main() {
	await scenario(false);
	await scenario(true);
}

main()
	.catch(async (error: unknown) => {
		// Never print Prisma errors, payloads, cookies, keys, or response bodies.
		console.error(
			`FAIL ${step}: ${error instanceof RecoveryFailure ? error.message : "Unexpected local transport, schema or database failure."}`,
		);
		if (testSessionId && cookie) {
			try {
				await trpc("settle", { sessionId: testSessionId }, txSchema);
				await trpc("closeSession", { sessionId: testSessionId }, txSchema);
				console.log(
					"CLEANUP isolated recovery-test session reconciled and closed",
				);
			} catch {
				console.error(
					`CLEANUP local test session requires review: ${testSessionId}`,
				);
			}
		}
		process.exitCode = 1;
	})
	.finally(async () => {
		await db?.$disconnect();
	});
