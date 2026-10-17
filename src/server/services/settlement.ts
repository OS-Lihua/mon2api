import { ensureChainBinding } from "./runtime";
import "server-only";
import { keccak256, stringToHex } from "viem";
import { db } from "~/server/db";
import { AppError } from "./auth";
import {
	findSettlement,
	readSession,
	sendClose,
	sendSettlement,
} from "./chain";
import { lock } from "./market";

export async function settleSession(
	sessionId: string,
	caller?: string,
): Promise<{ txHash: string | null }> {
	await ensureChainBinding();
	const lease = await db.lease.findUnique({ where: { id: sessionId } });
	if (
		!lease ||
		(caller && lease.consumer !== caller && lease.provider !== caller)
	)
		throw new AppError("not_found", "会话不存在。", 404);
	const job = await db.$transaction(async (tx) => {
		await lock(tx, sessionId);
		const existing = await tx.settlement.findFirst({
			where: { sessionId, status: "READY" },
			orderBy: { nonce: "asc" },
		});
		if (existing) return existing;
		const current = await tx.lease.findUniqueOrThrow({
			where: { id: sessionId },
		});
		const requests = await tx.meterRequest.findMany({
			where: { sessionId, status: "COMPLETED", settlementId: null },
			orderBy: { id: "asc" },
		});
		const amount = requests.reduce((n, r) => n + r.cost, 0);
		if (!amount) return null;
		const previous = await tx.settlement.findFirst({
			where: { sessionId, status: "CONFIRMED" },
			orderBy: { nonce: "desc" },
		});
		const cumulative = current.settled + amount;
		const receiptsHash = keccak256(
			stringToHex(
				JSON.stringify(
					requests.map((r) => ({
						id: r.id,
						cost: r.cost,
						input: r.inputTokens,
						output: r.outputTokens,
						source: r.usageSource,
						upstream: r.upstreamId,
					})),
				),
			),
		);
		const created = await tx.settlement.create({
			data: {
				sessionId,
				amount,
				cumulative,
				nonce: previous ? previous.nonce + 1 : 0,
				receiptsHash,
			},
		});
		await tx.meterRequest.updateMany({
			where: { id: { in: requests.map((r) => r.id) } },
			data: { settlementId: created.id },
		});
		return created;
	});
	if (!job) return { txHash: null };
	// The durable outbox is committed before sending. Recovery matches its nonce
	// and receipt hash against events, including a crash before txHash was saved.
	let txHash = job.txHash;
	let state = await readSession(sessionId);
	if (state.nonce > job.nonce) {
		txHash = await findSettlement(sessionId, job.nonce, job.receiptsHash);
		if (!txHash || state.spent < job.cumulative)
			throw new AppError(
				"settlement_conflict",
				"链上结算与本地账单不一致，请运营者核对。",
				409,
			);
	} else {
		if (state.closed || state.nonce !== job.nonce)
			throw new AppError(
				"settlement_closed",
				"链上会话已关闭或结算序号不符。",
				409,
			);
		try {
			txHash = await sendSettlement(
				sessionId,
				job.cumulative,
				job.nonce,
				job.receiptsHash,
			);
		} catch {
			txHash = await findSettlement(sessionId, job.nonce, job.receiptsHash);
			if (!txHash)
				throw new AppError(
					"settlement_retry",
					"结算尚未确认，账单已保存，可安全重试。",
					503,
				);
		}
		state = await readSession(sessionId);
		if (state.spent < job.cumulative || state.nonce <= job.nonce)
			throw new AppError("settlement_retry", "链上结算尚未确认。", 503);
	}
	await db.$transaction(async (tx) => {
		await lock(tx, sessionId);
		const current = await tx.settlement.findUniqueOrThrow({
			where: { id: job.id },
		});
		if (current.status === "CONFIRMED") return;
		await tx.settlement.update({
			where: { id: job.id },
			data: { status: "CONFIRMED", txHash },
		});
		await tx.lease.update({
			where: { id: sessionId },
			data: { settled: job.cumulative },
		});
		await tx.ledgerEntry.create({
			data: { sessionId, kind: "SETTLE", amount: job.amount },
		});
	});
	return { txHash };
}
export async function closeSession(sessionId: string, caller: string) {
	const lease = await db.lease.findUnique({ where: { id: sessionId } });
	if (!lease || lease.consumer !== caller)
		throw new AppError("not_found", "只能关闭自己的消费会话。", 404);
	if (lease.status === "CLOSED") return { txHash: lease.closeTx };
	const pending = await db.$transaction(async (tx) => {
		await lock(tx, sessionId);
		await tx.lease.update({
			where: { id: sessionId },
			data: { status: "CLOSING" },
		});
		return tx.meterRequest.count({
			where: { sessionId, status: { in: ["RUNNING", "REVIEW"] } },
		});
	});
	if (pending)
		throw new AppError(
			"pending_requests",
			"会话已停止接单；存在执行中或待核对请求，处理后可重试关闭。",
			409,
		);
	// A READY batch can predate another completed request. Drain both before
	// refunding; finishing just the first batch would leave earned usage unpaid.
	for (let attempt = 0; attempt < 3; attempt++) {
		const current = await db.lease.findUniqueOrThrow({
			where: { id: sessionId },
		});
		if (current.spent === current.settled) break;
		await settleSession(sessionId, caller);
	}
	const reconciled = await db.lease.findUniqueOrThrow({
		where: { id: sessionId },
	});
	const chain = await readSession(sessionId);
	if (
		reconciled.reserved !== 0 ||
		reconciled.spent !== reconciled.settled ||
		chain.spent !== reconciled.spent
	)
		throw new AppError(
			"unsettled_usage",
			"账单尚未全部核销，暂不能释放预算。",
			409,
		);
	const txHash = chain.closed ? null : await sendClose(sessionId);
	await db.$transaction(async (tx) => {
		await lock(tx, sessionId);
		const current = await tx.lease.findUniqueOrThrow({
			where: { id: sessionId },
		});
		if (current.status === "CLOSED") return;
		await tx.lease.update({
			where: { id: sessionId },
			data: { status: "CLOSED", closeTx: txHash },
		});
		await tx.accessKey.updateMany({
			where: { sessionId },
			data: { revoked: true },
		});
		await tx.ledgerEntry.create({
			data: {
				sessionId,
				kind: "REFUND_AVAILABLE",
				amount: current.budget - current.settled,
			},
		});
	});
	return { txHash };
}
export async function processSettlementQueue() {
	const cutoff = new Date(Date.now() - 90_000);
	// A worker crash is not evidence of zero upstream usage. Keep the hold.
	await db.meterRequest.updateMany({
		where: { status: "RUNNING", createdAt: { lt: cutoff } },
		data: { status: "REVIEW", errorCode: "worker_interrupted" },
	});
	const sessions = await db.lease.findMany({
		where: {
			requests: {
				some: {
					status: "COMPLETED",
					OR: [{ settlementId: null }, { settlement: { status: "READY" } }],
				},
			},
		},
		select: { id: true },
	});
	const results: { sessionId: string; ok: boolean }[] = [];
	for (const session of sessions) {
		try {
			await settleSession(session.id);
			results.push({ sessionId: session.id, ok: true });
		} catch {
			results.push({ sessionId: session.id, ok: false });
		}
	}
	return results;
}
