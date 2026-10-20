import "server-only";
import { db } from "~/server/db";
import { assetOf, billingUnit } from "~/shared/settlement-asset";
import type { RefundView, Viewer } from "~/shared/token2api";
import { AppError } from "./auth";
import { lock } from "./market";
import { chainConfig, ensureChainBinding } from "./runtime";
import { closeSession } from "./settlement";

export async function refundStatus(
	user: Viewer,
	sessionId: string,
): Promise<RefundView> {
	await ensureChainBinding();
	const lease = await db.lease.findUnique({ where: { id: sessionId } });
	if (!lease || lease.consumer !== user.address)
		throw new AppError("not_found", "退款会话不存在。", 404);
	const application = await db.ledgerEntry.findFirst({
		where: { sessionId, kind: "REFUND_REQUEST" },
		orderBy: { createdAt: "asc" },
	});
	if (!application)
		throw new AppError("not_found", "该会话尚未申请退款。", 404);
	const review = await db.meterRequest.count({
		where: { sessionId, status: "REVIEW" },
	});
	const closed = lease.status === "CLOSED";
	return {
		sessionId,
		status: closed ? "AVAILABLE" : review ? "PENDING_REVIEW" : "PROCESSING",
		// A confirmed forced close can include operating losses: refund follows paid
		// chain usage, never the larger off-chain earned/spent amount.
		amount: closed
			? lease.budget - lease.settled
			: lease.budget - lease.spent - lease.reserved,
		reserved: lease.reserved,
		unit: billingUnit(assetOf(chainConfig())),
		requestedAt: application.createdAt.toISOString(),
		txHash: lease.closeTx,
		withdrawRequired: closed,
	};
}

/** Request unused-budget release. Wallet withdrawal is a separate signed action. */
export async function requestRefund(
	user: Viewer,
	sessionId: string,
): Promise<RefundView> {
	await ensureChainBinding();
	await db.$transaction(async (tx) => {
		await lock(tx, sessionId);
		const lease = await tx.lease.findUnique({ where: { id: sessionId } });
		if (!lease || lease.consumer !== user.address)
			throw new AppError("not_found", "只能为自己的预算会话申请退款。", 404);
		if (!["ACTIVE", "CLOSING", "CLOSED"].includes(lease.status))
			throw new AppError(
				"unfunded_session",
				"预算尚未确认，不能申请退款。",
				409,
			);
		const existing = await tx.ledgerEntry.findFirst({
			where: { sessionId, kind: "REFUND_REQUEST" },
		});
		if (!existing)
			await tx.ledgerEntry.create({
				data: {
					sessionId,
					kind: "REFUND_REQUEST",
					amount: lease.budget - lease.spent - lease.reserved,
				},
			});
		if (lease.status !== "CLOSED")
			await tx.lease.update({
				where: { id: sessionId },
				data: { status: "CLOSING" },
			});
	});
	try {
		await closeSession(sessionId, user.address);
	} catch (error) {
		// The durable CLOSING state is resumed by the settlement worker. Unknown
		// usage keeps its reservation; acceptance is not a promise of zero usage.
		if (
			!(error instanceof AppError) ||
			!["pending_requests", "unsettled_usage", "settlement_retry"].includes(
				error.code,
			)
		)
			throw error;
	}
	return refundStatus(user, sessionId);
}
