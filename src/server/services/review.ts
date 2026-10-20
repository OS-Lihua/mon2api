import "server-only";
import { db } from "~/server/db";
import { AppError } from "./auth";
import { lock } from "./market";
import { calculateCost } from "./metering";

/** Operator-only CLI entry point. There is deliberately no public resolution API. */
export async function resolveReview(
	id: string,
	inputTokens: number,
	outputTokens: number,
	evidence: string,
) {
	if (!evidence.trim() || evidence.length > 160)
		throw new AppError(
			"evidence_required",
			"需要上游账单或审计记录的引用，最长160字符。",
		);
	return db.$transaction(async (tx) => {
		const request = await tx.meterRequest.findUniqueOrThrow({
			where: { id },
			include: { session: true },
		});
		await lock(tx, request.sessionId);
		const current = await tx.meterRequest.findUniqueOrThrow({ where: { id } });
		if (current.status !== "REVIEW")
			throw new AppError("not_review", "请求当前不处于待核对状态。", 409);
		const cost = calculateCost(
			inputTokens,
			outputTokens,
			request.session.inputRate,
			request.session.outputRate,
		);
		if (cost > request.reservation)
			throw new AppError(
				"over_reservation",
				"核对费用超出授权预留额，不能自动转嫁给用户。",
				409,
			);
		const transition = await tx.meterRequest.updateMany({
			where: { id, status: "REVIEW" },
			data: {
				status: "COMPLETED",
				inputTokens,
				outputTokens,
				cost,
				usageSource: "operator_verified",
				errorCode: `evidence:${evidence}`,
			},
		});
		if (transition.count !== 1)
			throw new AppError("not_review", "请求当前不处于待核对状态。", 409);
		await tx.lease.update({
			where: { id: request.sessionId },
			data: {
				reserved: { decrement: request.reservation },
				spent: { increment: cost },
			},
		});
		await tx.ledgerEntry.createMany({
			data: [
				{
					sessionId: request.sessionId,
					requestId: id,
					kind: "REVIEW_CAPTURE",
					amount: cost,
				},
				{
					sessionId: request.sessionId,
					requestId: id,
					kind: "RELEASE",
					amount: request.reservation - BigInt(cost),
				},
			],
		});
		return { id, cost };
	});
}
