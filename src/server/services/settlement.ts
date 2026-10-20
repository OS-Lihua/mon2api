import { ensureChainBinding } from "./runtime";
import "server-only";
import type { Prisma } from "@prisma/client";
import { keccak256, stringToHex } from "viem";
import { db } from "~/server/db";
import { AppError } from "./auth";
import {
	findSessionClose,
	findSettlement,
	readSession,
	sendClose,
	sendSettlement,
} from "./chain";
import { ledgerAmount } from "./ledger";
import { lock } from "./market";
export async function settleSession(
	sessionId: string,
	caller?: string,
): Promise<{
	txHash: string | null;
}> {
	await ensureChainBinding();
	const lease = await db.lease.findUnique({ where: { id: sessionId } });
	if (
		!lease ||
		(caller && lease.consumer !== caller && lease.provider !== caller)
	)
		throw new AppError("not_found", "会话不存在。", 404);
	let lastHash: string | null = null;
	// A chain close can follow an unrecorded successful batch. Recover that batch
	// before classifying later earned usage as an operating loss.
	for (;;) {
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
				where: {
					sessionId,
					status: "COMPLETED",
					settlementId: null,
					cost: { gt: 0 },
				},
				orderBy: { id: "asc" },
			});
			const amount = requests.reduce((n, r) => n + r.cost, 0n);
			if (!amount) return null;
			const previous = await tx.settlement.findFirst({
				where: { sessionId },
				orderBy: { nonce: "desc" },
			});
			const receiptsHash = keccak256(
				stringToHex(
					JSON.stringify(
						requests.map((r) => ({
							id: r.id,
							cost: ledgerAmount(r.cost),
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
					cumulative: current.settled + current.writtenOff + amount,
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
		let state = await readSession(sessionId);
		if (job && state.nonce > job.nonce) {
			const txHash = await findSettlement(
				sessionId,
				job.nonce,
				job.receiptsHash,
				ledgerAmount(job.cumulative),
			);
			if (!txHash || state.spent < job.cumulative)
				throw new AppError(
					"settlement_conflict",
					"链上结算与本地账单不一致，请运营者核对。",
					409,
				);
			await confirmJob(job, txHash);
			lastHash = txHash;
			if (state.closed) continue;
			return { txHash };
		}
		if (state.closed) {
			// Do not turn a provisional latest block (or an RPC failure) into a loss.
			const closure = await findSessionClose(sessionId);
			await db.$transaction(async (tx) => {
				await lock(tx, sessionId);
				await tx.chainTransaction.updateMany({
					where: { hash: closure.txHash, status: "PENDING" },
					data: { status: "CONFIRMED" },
				});
				const current = await tx.lease.findUniqueOrThrow({
					where: { id: sessionId },
				});
				if (BigInt(closure.state.spent) !== current.settled)
					throw new AppError(
						"settlement_conflict",
						"关闭前的链上结算尚未全部恢复。",
						409,
					);
				if (job) {
					if (closure.state.nonce > job.nonce)
						throw new AppError(
							"settlement_retry",
							"关闭前的结算需要先恢复。",
							503,
						);
					const transition = await tx.settlement.updateMany({
						where: { id: job.id, status: "READY" },
						data: { status: "UNCOLLECTIBLE" },
					});
					if (transition.count === 1) {
						await tx.lease.update({
							where: { id: sessionId },
							data: { writtenOff: { increment: job.amount } },
						});
						await tx.ledgerEntry.create({
							data: { sessionId, kind: "OPERATING_LOSS", amount: job.amount },
						});
					}
				}
				await tx.lease.update({
					where: { id: sessionId },
					data: { status: "CLOSED", closeTx: closure.txHash },
				});
				await tx.accessKey.updateMany({
					where: { sessionId },
					data: { revoked: true },
				});
				if (current.status !== "CLOSED")
					await tx.ledgerEntry.create({
						data: {
							sessionId,
							kind: "REFUND_AVAILABLE",
							amount: closure.state.budget - closure.state.spent,
						},
					});
			});
			if (job) continue;
			return { txHash: lastHash };
		}
		if (!job) return { txHash: lastHash };
		if (state.nonce !== job.nonce)
			throw new AppError("settlement_conflict", "链上结算序号不符。", 409);
		// The outbox is durable before sending; every recovery waits for the same
		// canonical receipt confirmations and exact UsageSettled event as a send.
		let txHash: string | null;
		try {
			txHash = await sendSettlement(
				sessionId,
				ledgerAmount(job.cumulative),
				job.nonce,
				job.receiptsHash,
			);
		} catch {
			txHash = await findSettlement(
				sessionId,
				job.nonce,
				job.receiptsHash,
				ledgerAmount(job.cumulative),
			);
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
		await confirmJob(job, txHash);
		lastHash = txHash;
		if (state.closed) continue;
		return { txHash };
	}
}
async function confirmJob(
	job: {
		id: string;
		sessionId: string;
		cumulative: bigint;
		amount: bigint;
	},
	txHash: string,
) {
	await db.$transaction(async (tx) => {
		await lock(tx, job.sessionId);
		await tx.chainTransaction.updateMany({
			where: { hash: txHash, status: "PENDING" },
			data: { status: "CONFIRMED" },
		});
		const transition = await tx.settlement.updateMany({
			where: { id: job.id, status: "READY" },
			data: { status: "CONFIRMED", txHash },
		});
		if (transition.count !== 1) return;
		await tx.lease.update({
			where: { id: job.sessionId },
			data: { settled: job.cumulative },
		});
		await tx.ledgerEntry.create({
			data: { sessionId: job.sessionId, kind: "SETTLE", amount: job.amount },
		});
	});
}
export async function closeSession(sessionId: string, caller?: string) {
	const lease = await db.lease.findUnique({ where: { id: sessionId } });
	if (
		!lease ||
		(caller ? lease.consumer !== caller : lease.status !== "CLOSING")
	)
		throw new AppError("not_found", "只能关闭自己的消费会话。", 404);
	if (lease.status === "CLOSED") {
		await settleSession(sessionId, caller);
		return { txHash: lease.closeTx };
	}
	const pending = await db.$transaction(async (tx) => {
		await lock(tx, sessionId);
		await tx.lease.updateMany({
			where: { id: sessionId, status: { not: "CLOSED" } },
			data: { status: "CLOSING" },
		});
		return tx.meterRequest.count({
			where: { sessionId, status: { in: ["RUNNING", "REVIEW"] } },
		});
	});
	if ((await readSession(sessionId)).closed) {
		await settleSession(sessionId, caller);
		const closed = await db.lease.findUniqueOrThrow({
			where: { id: sessionId },
		});
		return { txHash: closed.closeTx };
	}
	if (pending)
		throw new AppError(
			"pending_requests",
			"会话已停止接单；存在执行中或待核对请求，处理后可重试关闭。",
			409,
		);
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
	if (chain.closed) {
		await settleSession(sessionId, caller);
		const closed = await db.lease.findUniqueOrThrow({
			where: { id: sessionId },
		});
		return { txHash: closed.closeTx };
	}
	if (
		reconciled.reserved !== 0n ||
		reconciled.spent !== reconciled.settled ||
		BigInt(chain.spent) !== reconciled.spent
	)
		throw new AppError(
			"unsettled_usage",
			"账单尚未全部核销，暂不能释放预算。",
			409,
		);
	const txHash = await sendClose(sessionId);
	// Also handles a consumer close racing the meter's close transaction.
	await settleSession(sessionId, caller);
	return { txHash };
}
let activeAuditCursor: string | undefined;
let pendingCursor: string | undefined;
let interruptedCursor: string | undefined;

export async function processSettlementQueue() {
	const cutoff = new Date(Date.now() - 90000);
	const interrupted = await db.meterRequest.findMany({
		where: {
			status: "RUNNING",
			createdAt: { lt: cutoff },
			...(interruptedCursor ? { id: { gt: interruptedCursor } } : {}),
		},
		select: { id: true, sessionId: true },
		orderBy: { id: "asc" },
		take: 100,
	});
	interruptedCursor =
		interrupted.length === 100 ? interrupted.at(-1)?.id : undefined;
	for (const request of interrupted) {
		await db.$transaction(async (tx) => {
			await lock(tx, request.sessionId);
			await tx.meterRequest.updateMany({
				where: { id: request.id, status: "RUNNING", createdAt: { lt: cutoff } },
				data: { status: "REVIEW", errorCode: "worker_interrupted" },
			});
		});
	}
	const pendingWork: Prisma.LeaseWhereInput = {
		OR: [
			{ status: "CLOSING" },
			{ settlements: { some: { status: "READY" } } },
			{
				requests: {
					some: { status: "COMPLETED", cost: { gt: 0 }, settlementId: null },
				},
			},
		],
	};
	const [pending, audit] = await Promise.all([
		db.lease.findMany({
			where: {
				AND: [
					pendingWork,
					...(pendingCursor ? [{ id: { gt: pendingCursor } }] : []),
				],
			},
			select: { id: true },
			orderBy: { id: "asc" },
			take: 100,
		}),
		db.lease.findMany({
			where: {
				status: "ACTIVE",
				...(activeAuditCursor ? { id: { gt: activeAuditCursor } } : {}),
			},
			select: { id: true },
			orderBy: { id: "asc" },
			take: 10,
		}),
	]);
	pendingCursor = pending.length === 100 ? pending.at(-1)?.id : undefined;
	activeAuditCursor = audit.length === 10 ? audit.at(-1)?.id : undefined;
	const sessions = [
		...new Map([...pending, ...audit].map((row) => [row.id, row])).values(),
	];
	const outcomes = new Map<string, boolean>();
	let cursor = 0;
	await Promise.all(
		Array.from({ length: Math.min(4, sessions.length) }, async () => {
			for (;;) {
				const session = sessions[cursor++];
				if (!session) return;
				try {
					await settleSession(session.id);
					const lease = await db.lease.findUniqueOrThrow({
						where: { id: session.id },
					});
					if (lease.status === "CLOSING") await closeSession(session.id);
					outcomes.set(session.id, true);
				} catch {
					outcomes.set(session.id, false);
				}
			}
		}),
	);
	return sessions.map(({ id }) => ({
		sessionId: id,
		ok: outcomes.get(id) === true,
	}));
}
