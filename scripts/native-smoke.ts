import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import ganache from "ganache";
import {
	type Abi,
	createPublicClient,
	createWalletClient,
	type Hex,
	http,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { escrowAbi, tokenAbi } from "../src/lib/abi";
import {
	balanceUnit,
	billingUnit,
	NATIVE_TOKEN,
	toChainAmount,
} from "../src/shared/settlement-asset";

// No external signers, public RPCs or existing ledger rows are used by this test.
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost", "[::1]"].includes(databaseUrl.hostname))
	throw new Error("Native smoke requires a local database endpoint.");
const asset = process.argv.includes("--stable") ? "USDC" : "ETH";
const tokenDecimals =
	asset === "USDC" && !process.argv.includes("--18-decimals") ? 6 : 18;
const namespace = `native_smoke_${randomBytes(8).toString("hex")}`;
const admin = new PrismaClient();
databaseUrl.searchParams.set("schema", namespace);
process.env.DATABASE_URL = databaseUrl.toString();
process.env.TOKEN2API_MODE = "local";
process.env.ALLOW_DEMO = "true";
process.env.APP_ORIGIN = "http://localhost:3000";
process.env.RATE_LIMIT_ENABLED = "false";
const mnemonic = "test test test test test test test test test test test junk";
const account = (index: number) =>
	mnemonicToAccount(mnemonic, { addressIndex: index });
const server = ganache.server({
	chain: { chainId: 31337, hardfork: "shanghai" },
	wallet: { mnemonic, totalAccounts: 6, defaultBalance: 1000 },
	logging: { quiet: true },
});
let appDb: PrismaClient | undefined;
try {
	await admin.$executeRawUnsafe(`CREATE SCHEMA "${namespace}"`);
	const migration = spawnSync(
		process.execPath,
		["node_modules/prisma/build/index.js", "migrate", "deploy"],
		{ env: process.env, encoding: "utf8" },
	);
	assert.equal(migration.status, 0, "Isolated native asset migration failed");
	const compile = spawnSync(
		process.execPath,
		["scripts/compile.mjs", "--test-tokens"],
		{
			encoding: "utf8",
		},
	);
	assert.equal(compile.status, 0, "Native contract compile failed");
	await server.listen(0, "127.0.0.1");
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing EVM endpoint");
	const rpcUrl = `http://127.0.0.1:${address.port}`;
	const client = createPublicClient({
		chain: foundry,
		transport: http(rpcUrl),
		cacheTime: 0,
		pollingInterval: 20,
	});
	const wallet = createWalletClient({
		chain: foundry,
		transport: http(rpcUrl),
		account: account(0),
	});
	const artifact = (name: string) =>
		JSON.parse(readFileSync(`contracts/artifacts/${name}.json`, "utf8")) as {
			abi: Abi;
			bytecode: Hex;
		};
	let token: Hex = NATIVE_TOKEN;
	if (asset === "USDC") {
		const deployed = await client.waitForTransactionReceipt({
			hash: await wallet.deployContract({
				...artifact("SettlementTestToken"),
				args: [tokenDecimals],
			}),
		});
		assert.ok(deployed.contractAddress);
		token = deployed.contractAddress;
		await client.waitForTransactionReceipt({
			hash: await wallet.writeContract({
				address: token,
				abi: tokenAbi,
				functionName: "mint",
				args: [
					account(0).address,
					toChainAmount(100_000_000, asset, tokenDecimals),
				],
			}),
		});
	}
	const deployment = await client.waitForTransactionReceipt({
		hash: await wallet.deployContract({
			...artifact(asset === "ETH" ? "NativeUsageEscrow" : "UsageEscrow"),
			args:
				asset === "ETH"
					? [account(4).address, account(5).address, 500]
					: [token, account(4).address, account(5).address, 500],
		}),
	});
	assert.ok(deployment.contractAddress);
	const escrow = deployment.contractAddress;
	process.env.CHAIN_CONFIG_JSON = JSON.stringify({
		mode: "local",
		asset,
		tokenDecimals,
		chainId: 31337,
		rpcUrl,
		escrow,
		token,
		meter: account(4).address,
		treasury: account(5).address,
		deploymentBlock: deployment.blockNumber.toString(),
	});
	const [{ db }, market, settlement, metering, routes, commerce] =
		await Promise.all([
			import("../src/server/db"),
			import("../src/server/services/market"),
			import("../src/server/services/settlement"),
			import("../src/server/services/metering"),
			import("../src/server/rest/chat"),
			import("../src/server/services/commerce"),
		]);
	appDb = db;
	const buyer = {
		address: account(0).address.toLowerCase(),
		name: "Buyer",
		demo: true,
	};
	const seller = {
		address: account(1).address.toLowerCase(),
		name: "Seller",
		demo: true,
	};
	const listing = await market.createListing(seller, {
		name: "Native token fixture",
		description: "Isolated simulated text resource",
		model: "token2api-demo",
		kind: "demo",
		connectionMode: "api",
		inputRate: 1_000_000,
		outputRate: 3_000_000,
		concurrency: 2,
	});
	const opened = await market.openSession(buyer, {
		listingId: listing.id,
		budget: 1_000_000,
	});
	assert.ok(
		opened.connection,
		"Funded budget must return connection credentials",
	);
	assert.equal(opened.connection.base_url, "http://localhost:3000/v1");
	assert.equal(opened.connection.model, "token2api-demo");
	assert.equal(
		await db.accessKey.count({ where: { sessionId: opened.id } }),
		1,
	);
	const repeated = await market.confirmSession(
		buyer,
		opened.id,
		undefined,
		true,
	);
	assert.equal(repeated.connection, undefined);
	assert.equal(
		await db.accessKey.count({ where: { sessionId: opened.id } }),
		1,
	);
	console.log(
		"PASS native deposit -> database activation -> one-time buyer connection bundle",
	);
	const request = () =>
		new Request("http://localhost:3000/v1/chat/completions", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${opened.connection?.key}`,
				"idempotency-key": "native-flow-request-0001",
			},
			body: JSON.stringify({
				model: opened.connection?.model,
				messages: [
					{ role: "user", content: "Explain native asset settlement" },
				],
				max_tokens: 128,
			}),
		});
	const response = await routes.chatPost(request());
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.token2api.unit, billingUnit(asset));
	assert.ok(body.token2api.cost > 0);
	const replay = await routes.chatPost(request());
	assert.equal(replay.status, 409);
	assert.equal(
		await db.meterRequest.count({ where: { sessionId: opened.id } }),
		1,
	);
	const billed = await db.lease.findUniqueOrThrow({ where: { id: opened.id } });
	assert.equal(billed.reserved, 0);
	assert.equal(billed.spent, body.token2api.cost);
	console.log(
		"PASS REST inference with returned Key/model, micro-units bill and duplicate protection",
	);
	// Force an unknown-usage request through REVIEW and verify the reservation survives.
	await db.$transaction(async (tx) => {
		await tx.meterRequest.create({
			data: {
				sessionId: opened.id,
				idempotencyKey: "unknown-usage-test",
				reservation: 1000,
				status: "REVIEW",
			},
		});
		await tx.lease.update({
			where: { id: opened.id },
			data: { reserved: { increment: 1000 } },
		});
	});
	const refund = await import("../src/server/services/refund");
	const application = await refund.requestRefund(buyer, opened.id);
	assert.equal(application.status, "PENDING_REVIEW");
	assert.equal(application.reserved, 1000);
	await refund.requestRefund(buyer, opened.id);
	assert.equal(
		await db.ledgerEntry.count({
			where: { sessionId: opened.id, kind: "REFUND_REQUEST" },
		}),
		1,
	);

	assert.equal(
		(await db.lease.findUniqueOrThrow({ where: { id: opened.id } })).reserved,
		1000,
	);
	const review = await db.meterRequest.findUniqueOrThrow({
		where: {
			sessionId_idempotencyKey: {
				sessionId: opened.id,
				idempotencyKey: "unknown-usage-test",
			},
		},
	});
	const { resolveReview } = await import("../src/server/services/review");
	await resolveReview(review.id, 0, 0, "local fixture: confirmed no execution");
	console.log(
		"PASS REVIEW retains reservation and blocks early refund until evidence resolution",
	);
	const refunded = await refund.requestRefund(buyer, opened.id);
	assert.equal(refunded.status, "AVAILABLE");
	assert.equal(refunded.amount, 1_000_000 - body.token2api.cost);
	const closed = await db.lease.findUniqueOrThrow({ where: { id: opened.id } });
	assert.equal(closed.status, "CLOSED");
	assert.equal(closed.settled, closed.spent);
	const gross = toChainAmount(closed.spent, asset, tokenDecimals);
	const balance = (owner: Hex) =>
		client.readContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "claimable",
			args: [owner],
		});
	assert.equal(
		await balance(account(1).address),
		gross - (gross * 500n) / 10_000n,
	);
	assert.equal(await balance(account(5).address), (gross * 500n) / 10_000n);
	assert.equal(
		await balance(account(0).address),
		toChainAmount(closed.budget - closed.spent, asset, tokenDecimals),
	);
	const snapshot = await market.snapshot(buyer);
	assert.equal(snapshot.network.asset, asset);
	assert.equal(snapshot.network.ledgerUnit, billingUnit(asset));
	assert.equal(snapshot.network.balanceUnit, balanceUnit(asset));
	assert.equal(
		(await commerce.accountBalances(buyer)).unit,
		balanceUnit(asset),
	);
	assert.equal((await routes.chatPost(request())).status, 401);
	await market.withdraw(buyer);
	await market.withdraw(seller);
	const treasury = createWalletClient({
		chain: foundry,
		transport: http(rpcUrl),
		account: account(5),
	});
	await client.waitForTransactionReceipt({
		hash: await treasury.writeContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "withdraw",
		}),
	});
	assert.equal(
		asset === "ETH"
			? await client.getBalance({ address: escrow })
			: await client.readContract({
					address: token,
					abi: tokenAbi,
					functionName: "balanceOf",
					args: [escrow],
				}),
		0n,
	);
	console.log(
		`PASS ${asset} (${tokenDecimals} decimals): settlement, refund, withdrawals conserve all funds`,
	);
	assert.equal(
		await db.ledgerEntry.count({
			where: { sessionId: opened.id, kind: "SETTLE" },
		}),
		1,
	);
	// Confirmed chain success with lost DB confirmation must recover the same event.
	const recovered = await market.openSession(buyer, {
		listingId: listing.id,
		budget: 1_000_000,
	});
	await metering.runChat(buyer.address, {
		sessionId: recovered.id,
		messages: [{ role: "user", content: "recovery" }],
		maxTokens: 128,
		conversationId: "native-recovery",
		idempotencyKey: "native-recovery-0001",
	});
	await settlement.settleSession(recovered.id);
	const job = await db.settlement.findFirstOrThrow({
		where: { sessionId: recovered.id },
	});
	await db.$transaction(async (tx) => {
		await tx.settlement.update({
			where: { id: job.id },
			data: { status: "READY", txHash: null },
		});
		await tx.lease.update({
			where: { id: recovered.id },
			data: { settled: 0 },
		});
		await tx.ledgerEntry.deleteMany({
			where: { sessionId: recovered.id, kind: "SETTLE" },
		});
	});
	const recovery = await settlement.settleSession(recovered.id);
	assert.equal(recovery.txHash, job.txHash);
	assert.equal(
		await db.settlement.count({ where: { sessionId: recovered.id } }),
		1,
	);
	assert.equal(
		await db.ledgerEntry.count({
			where: { sessionId: recovered.id, kind: "SETTLE" },
		}),
		1,
	);
	await settlement.closeSession(recovered.id, buyer.address);
	console.log(
		"PASS native fee/refund/withdrawal conservation, key revocation and durable settlement recovery",
	);
} finally {
	await appDb?.$disconnect();
	await server.close();
	await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
	await admin.$disconnect();
}
