import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createWalletClient, getAddress, http, isHex } from "viem";
import { escrowAbi, tokenAbi } from "../src/lib/abi";
import { prepaidAbi } from "../src/lib/prepaid-abi";
import { db } from "../src/server/db";
import { chatPost, modelsGet } from "../src/server/rest/chat";
import {
	clients,
	demoAccount,
	readPrepaidBalance,
} from "../src/server/services/chain";
import { lookupRequest } from "../src/server/services/commerce";
import {
	createLocalListing,
	pollConnector,
	reportConnectorCatalog,
	updateConnector,
} from "../src/server/services/local-connector";
import {
	createModelKey,
	revokeKey,
	updateKeyModels,
} from "../src/server/services/market";
import { calculateCost } from "../src/server/services/metering";
import {
	modelCatalog,
	saveModel,
	saveModelRoute,
} from "../src/server/services/model-catalog";
import {
	prepaidAccount,
	recoverPrepaidReservations,
} from "../src/server/services/model-routing";
import { preparePrepaidTransfer } from "../src/server/services/prepaid-transfers";
import { requestRefund } from "../src/server/services/refund";
import { resolveReview } from "../src/server/services/review";
import { closeSession, settleSession } from "../src/server/services/settlement";
import {
	billingUnit,
	isNativeAsset,
	toChainAmount,
} from "../src/shared/settlement-asset";

/** Runs only inside native-smoke's fresh PostgreSQL schema and loopback EVM. */
export async function runModelRoutingScenarios() {
	const { config, chain, publicClient } = clients();
	assert.equal(config.mode, "local");
	assert.equal(config.chainId, 31337);
	assert.ok(
		["127.0.0.1", "localhost"].includes(new URL(config.rpcUrl).hostname),
	);
	const escrow = getAddress(config.escrow);
	const buyer = {
		address: demoAccount(0).address.toLowerCase(),
		name: "Model buyer",
		demo: false,
	};
	const seller = {
		address: demoAccount(1).address.toLowerCase(),
		name: "Model supplier",
		demo: false,
	};
	const administrator = {
		address: demoAccount(4).address.toLowerCase(),
		name: "Operator",
		demo: false,
	};
	const wallet = createWalletClient({
		account: demoAccount(0),
		chain,
		transport: http(config.rpcUrl),
	});
	const raw = (amount: number | bigint) =>
		toChainAmount(amount, config.asset, config.tokenDecimals);
	const balance = () => readPrepaidBalance(buyer.address);
	const model = {
		id: "platform-standard",
		name: "Uniform model",
		inputRate: 1_000_000,
		outputRate: 2_000_000,
		enabled: true,
	};
	await assert.rejects(saveModel(seller, model), /管理员钱包/);
	await saveModel(administrator, model);
	await saveModel(administrator, { ...model, id: "platform-other" });
	const key = await createModelKey(buyer, {
		name: "Production key",
		models: [model.id],
	});
	const storedKey = await db.accessKey.findFirstOrThrow({
		where: { owner: buyer.address, name: "Production key" },
	});
	assert.equal(storedKey.sessionId, null, "No user-selected lease is required");
	assert.notEqual(storedKey.hash, key.key);
	await assert.rejects(
		updateKeyModels(seller, storedKey.id, [model.id]),
		/不属于/,
	);
	await assert.rejects(
		createModelKey(buyer, { name: "Invalid", models: ["unknown"] }),
		/不存在/,
	);
	const request = (id: string, modelId = model.id, secret = key.key) =>
		new Request("http://localhost:3000/api/v1/chat/completions", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${secret}`,
				"idempotency-key": id,
			},
			body: JSON.stringify({
				model: modelId,
				messages: [{ role: "user", content: "hello" }],
				max_tokens: 128,
			}),
		});
	assert.equal(
		(await chatPost(request("routing-forbidden", "platform-other"))).status,
		403,
	);
	assert.equal((await chatPost(request("routing-unfunded"))).status, 402);
	assert.equal(
		await db.routedInvocation.count({ where: { accessKeyId: storedKey.id } }),
		0,
	);
	const modelList = await modelsGet(
		new Request("http://localhost:3000/api/v1/models", {
			headers: { authorization: `Bearer ${key.key}` },
		}),
	);
	assert.equal(modelList.status, 200);
	assert.deepEqual(
		(await modelList.json()).data.map((entry: { id: string }) => entry.id),
		[model.id],
	);
	const transfer = await preparePrepaidTransfer(buyer, {
		kind: "deposit",
		amount: 1_000_000,
	});
	for (const tx of transfer.transactions) {
		assert.ok(isHex(tx.data));
		const receipt = await publicClient.waitForTransactionReceipt({
			hash: await wallet.sendTransaction({
				to: getAddress(tx.to),
				data: tx.data,
				value: BigInt(tx.value),
			}),
		});
		assert.equal(receipt.status, "success");
	}
	assert.equal((await balance()).micro, 1_000_000);
	const resources = [];
	for (const [index, rate] of [
		[0, 500_000],
		[1, 250_000],
	] as const) {
		const listing = await createLocalListing(seller, {
			kind: "gateway",
			name: `Routed upstream ${index}`,
			description: "Isolated fixture",
			model: `upstream-${index}`,
			inputRate: rate,
			outputRate: rate + 250_000,
			concurrency: 1,
		});
		const authorization = `Bearer ${listing.token}`;
		await reportConnectorCatalog(authorization, [`upstream-${index}`]);
		await pollConnector(authorization);
		await saveModelRoute(administrator, {
			modelId: model.id,
			listingId: listing.id,
			priority: index,
			enabled: true,
		});
		resources.push({ ...listing, authorization, model: `upstream-${index}` });
	}
	const first = resources[0];
	const second = resources[1];
	assert.ok(first && second);
	assert.equal(
		(await modelCatalog()).find((item) => item.id === model.id)?.available,
		true,
	);
	let executions = 0;
	async function complete(resource: typeof first, review = false) {
		assert.ok(resource);
		for (let attempt = 0; attempt < 500; attempt++) {
			const polled = await pollConnector(resource.authorization);
			if (polled.job) {
				executions++;
				assert.equal(
					polled.job.input.model,
					resource.model,
					"Canonical model must map to upstream model",
				);
				await updateConnector(resource.authorization, {
					event: "complete",
					jobId: polled.job.id,
					revision: 1,
					text: "routed response",
					result: {
						text: "routed response",
						finishReason: "stop",
						inputTokens: review ? null : 12,
						outputTokens: review ? null : 24,
						usageSource: review ? "missing" : "upstream_reported",
						pendingReview: review,
						upstreamRequestId: "fixture-request",
					},
				});
				return;
			}
			await delay(20);
		}
		throw new Error("No routed connector job appeared");
	}
	const call = async (
		id: string,
		resource = first,
		review = false,
		secret = key.key,
	) => {
		const [response] = await Promise.all([
			chatPost(request(id, model.id, secret)),
			complete(resource, review),
		]);
		return response;
	};
	const response = await call("routing-first-call");
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.model, model.id);
	assert.equal(body.token2api.unit, billingUnit(config.asset));
	const retail = calculateCost(12, 24, model.inputRate, model.outputRate);
	const wholesale = calculateCost(12, 24, 500_000, 750_000);
	assert.equal(body.token2api.cost, retail);
	const original = await db.routedInvocation.findUniqueOrThrow({
		where: {
			accessKeyId_idempotencyKey: {
				accessKeyId: storedKey.id,
				idempotencyKey: "routing-first-call",
			},
		},
		include: { session: true },
	});
	assert.equal(original.session.listingId, first.id);
	assert.equal(original.session.status, "CLOSING");
	assert.equal(original.session.providerSpent, BigInt(wholesale));
	const providerBefore = await publicClient.readContract({
		address: escrow,
		abi: escrowAbi,
		functionName: "claimable",
		args: [demoAccount(1).address],
	});
	const ownerBefore = await publicClient.readContract({
		address: escrow,
		abi: escrowAbi,
		functionName: "claimable",
		args: [demoAccount(4).address],
	});
	await settleSession(original.sessionId);
	const job = await db.settlement.findFirstOrThrow({
		where: { sessionId: original.sessionId },
	});
	assert.equal(job.providerAmount, BigInt(wholesale));
	// Simulate a crash after a mined receipt but before local confirmation, then recover it.
	await db.settlement.update({
		where: { id: job.id },
		data: { status: "READY", txHash: null },
	});
	await db.lease.update({
		where: { id: original.sessionId },
		data: { settled: 0 },
	});
	await db.ledgerEntry.deleteMany({
		where: { sessionId: original.sessionId, kind: "SETTLE" },
	});
	assert.equal((await settleSession(original.sessionId)).txHash, job.txHash);
	assert.equal(
		await db.settlement.count({ where: { sessionId: original.sessionId } }),
		1,
	);
	await closeSession(original.sessionId, buyer.address);
	assert.equal((await balance()).micro, 1_000_000 - retail);
	const fee = (raw(wholesale) * 500n) / 10000n;
	assert.equal(
		await publicClient.readContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "claimable",
			args: [demoAccount(1).address],
		}),
		providerBefore + raw(wholesale) - fee,
	);
	assert.equal(
		await publicClient.readContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "claimable",
			args: [demoAccount(4).address],
		}),
		ownerBefore + raw(retail - wholesale) + fee,
	);
	const lookup = await lookupRequest(
		{ id: storedKey.id, owner: buyer.address, sessionId: null },
		"routing-first-call",
	);
	assert.equal(lookup.cost, retail);
	await updateKeyModels(buyer, storedKey.id, [model.id, "platform-other"]);
	assert.equal(
		(await chatPost(request("routing-first-call", "platform-other"))).status,
		409,
		"Idempotency spans all models and routes of a key",
	);
	await db.listing.update({
		where: { id: first.id },
		data: { enabled: false },
	});
	const key2 = await createModelKey(buyer, {
		name: "Another app",
		models: [model.id],
	});
	assert.equal(
		(await call("routing-second-call", second, false, key2.key)).status,
		200,
	);
	const alternate = await db.routedInvocation.findFirstOrThrow({
		where: { idempotencyKey: "routing-second-call" },
		include: { session: true },
	});
	assert.equal(alternate.session.listingId, second.id);
	assert.equal(
		alternate.session.spent,
		BigInt(retail),
		"Public price does not depend on upstream selection",
	);
	await closeSession(alternate.sessionId, buyer.address);
	assert.equal((await balance()).micro, 1_000_000 - 2 * retail);
	assert.equal((await chatPost(request("routing-first-call"))).status, 409);
	assert.equal(executions, 2);
	assert.equal((await call("routing-review-call", second, true)).status, 409);
	const review = await db.meterRequest.findFirstOrThrow({
		where: { idempotencyKey: "routing-review-call" },
		include: { session: true },
	});
	assert.equal(review.status, "REVIEW");
	assert.ok(review.session.reserved > 0n);
	assert.equal(
		(await prepaidAccount(buyer)).reserved,
		Number(review.reservation),
	);
	assert.equal(
		(await requestRefund(buyer, review.sessionId)).status,
		"PENDING_REVIEW",
	);
	await assert.rejects(
		closeSession(review.sessionId, buyer.address),
		/核对|未完成/,
	);
	await resolveReview(review.id, 12, 24, "fixture upstream invoice verified");
	const verified = await db.meterRequest.findUniqueOrThrow({
		where: { id: review.id },
	});
	assert.equal(
		verified.providerCost,
		BigInt(calculateCost(12, 24, 250_000, 500_000)),
	);
	await closeSession(review.sessionId, buyer.address);
	assert.equal((await balance()).micro, 1_000_000 - 3 * retail);
	const disposable = await db.lease.create({
		data: {
			id: `0x${buyer.address.slice(2)}${"ab".repeat(12)}`,
			listingId: second.id,
			consumer: buyer.address,
			provider: seller.address,
			model: model.id,
			inputRate: model.inputRate,
			outputRate: model.outputRate,
			upstreamModel: second.model,
			providerInputRate: 250_000,
			providerOutputRate: 500_000,
			termsHash: `0x${"cd".repeat(32)}`,
			budget: 1000,
			fundingSource: "PREPAID",
			status: "PREPARING",
			createdAt: new Date(Date.now() - 130_000),
			expiresAt: new Date(Date.now() + 3600_000),
		},
	});
	await recoverPrepaidReservations();
	assert.equal(
		(await db.lease.findUniqueOrThrow({ where: { id: disposable.id } })).status,
		"REJECTED",
	);
	assert.equal(executions, 3, "Recovery must never repeat inference");
	await revokeKey(buyer, storedKey.id);
	assert.equal((await chatPost(request("routing-revoked-key"))).status, 401);
	const withdrawal = await preparePrepaidTransfer(buyer, {
		kind: "withdraw",
		amount: 1000,
	});
	const tx = withdrawal.transactions[0];
	assert.ok(tx && isHex(tx.data));
	assert.equal(
		(
			await publicClient.waitForTransactionReceipt({
				hash: await wallet.sendTransaction({
					to: getAddress(tx.to),
					data: tx.data,
					value: BigInt(tx.value),
				}),
			})
		).status,
		"success",
	);
	assert.equal((await balance()).micro, 1_000_000 - 3 * retail - 1000);
	// The free account remains independent from legacy refund/claimable balances.
	assert.equal(
		await publicClient.readContract({
			address: escrow,
			abi: prepaidAbi,
			functionName: "prepaidBalance",
			args: [demoAccount(0).address],
		}),
		raw(1_000_000 - 3 * retail - 1000),
	);
	if (!isNativeAsset(config.asset))
		assert.ok(
			(await publicClient.readContract({
				address: getAddress(config.token),
				abi: tokenAbi,
				functionName: "balanceOf",
				args: [demoAccount(0).address],
			})) > 0n,
		);
	console.log(
		"PASS model key scopes, uniform prices, upstream routing, shared prepaid funds, split settlement recovery, REVIEW retention and wallet withdrawal",
	);
}
