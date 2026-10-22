import "server-only";
import { randomBytes } from "node:crypto";
import { keccak256, stringToHex } from "viem";
import type { z } from "zod";
import { db } from "~/server/db";
import { assetOf, decimalsOf } from "~/shared/settlement-asset";
import type { Viewer } from "~/shared/token2api";
import { AppError } from "./auth";
import {
	clients,
	readEscrowPaused,
	readPrepaidBalance,
	rejectUnsentPrepaidReservation,
	sendPrepaidReserve,
} from "./chain";
import { resourceAvailable } from "./connector-availability";
import { requireGatewayAccess } from "./gateway-access";
import { ledgerAmount } from "./ledger";
import { lock } from "./market";
import { calculateCost, runChat } from "./metering";
import { ensureChainBinding } from "./runtime";
import type { chatInput } from "./token2api.schema";

export type ModelChatArgs = Omit<z.infer<typeof chatInput>, "sessionId"> & {
	keyId: string;
	model: string;
};

export async function prepaidAccount(user: Viewer) {
	await ensureChainBinding();
	let balance: Awaited<ReturnType<typeof readPrepaidBalance>>;
	try {
		balance = await readPrepaidBalance(user.address);
	} catch {
		throw new AppError(
			"prepaid_unavailable",
			"当前合约未开通预付账户，或链上服务暂不可用。",
			503,
		);
	}
	const [preparing, allocated] = await Promise.all([
		db.lease.aggregate({
			where: {
				consumer: user.address,
				fundingSource: "PREPAID",
				status: "PREPARING",
			},
			_sum: { budget: true },
		}),
		db.lease.findMany({
			where: {
				consumer: user.address,
				fundingSource: "PREPAID",
				status: { in: ["ACTIVE", "CLOSING"] },
			},
			select: { budget: true, spent: true, reserved: true, settled: true },
		}),
	]);
	const pending = preparing._sum.budget ?? 0n;
	return {
		balance: balance.balance,
		available: Math.max(0, balance.micro - ledgerAmount(pending)),
		preparing: ledgerAmount(pending),
		reserved: ledgerAmount(
			allocated.reduce((sum, lease) => sum + lease.reserved, 0n),
		),
		pendingSettlement: ledgerAmount(
			allocated.reduce((sum, lease) => sum + lease.spent - lease.settled, 0n),
		),
		releasing: ledgerAmount(
			allocated.reduce(
				(sum, lease) => sum + lease.budget - lease.spent - lease.reserved,
				0n,
			),
		),
	};
}

/** Model permission and key ownership are checked again under admission locks. */
export async function runModelChat(
	owner: string,
	input: ModelChatArgs,
	onDelta: (text: string) => void | Promise<void> = () => undefined,
	signal?: AbortSignal,
) {
	await ensureChainBinding();
	if (signal?.aborted)
		throw new AppError("aborted", "请求已取消，尚未调用上游。", 499);
	if (await readEscrowPaused())
		throw new AppError("settlement_paused", "市场结算已暂停。", 503);
	const { config } = clients();
	const lease = await db.$transaction(
		async (tx) => {
			await lock(tx, `prepaid:${owner}`);
			const key = await tx.accessKey.findUnique({ where: { id: input.keyId } });
			if (!key || key.revoked || key.owner !== owner || key.sessionId !== null)
				throw new AppError("unauthorized", "模型密钥无效或已撤销。", 401);
			if (!key.models.includes(input.model))
				throw new AppError("model_forbidden", "此 Key 无权调用该模型。", 403);
			const duplicate = await tx.routedInvocation.findUnique({
				where: {
					accessKeyId_idempotencyKey: {
						accessKeyId: key.id,
						idempotencyKey: input.idempotencyKey,
					},
				},
			});
			if (duplicate)
				throw new AppError(
					"duplicate_request",
					"此幂等请求已受理；请查询原请求，不会重新选择上游或扣费。",
					409,
				);
			const model = await tx.modelProduct.findUnique({
				where: { id: input.model },
				include: {
					routes: {
						where: { enabled: true },
						orderBy: [{ priority: "asc" }, { id: "asc" }],
						include: { listing: true },
					},
				},
			});
			if (!model?.enabled)
				throw new AppError("model_not_available", "模型已停用或不存在。", 400);
			// Same conservative input ceiling as the existing text-only metering boundary.
			const budget = calculateCost(
				32768,
				input.maxTokens,
				model.inputRate,
				model.outputRate,
			);
			let available: number;
			try {
				available = (await readPrepaidBalance(owner)).micro;
			} catch {
				throw new AppError(
					"prepaid_unavailable",
					"预付余额尚不可用，请检查充值确认或合约配置。",
					503,
				);
			}
			const preparing = await tx.lease.aggregate({
				where: {
					consumer: owner,
					fundingSource: "PREPAID",
					status: "PREPARING",
				},
				_sum: { budget: true },
			});
			if (BigInt(available) - (preparing._sum.budget ?? 0n) < BigInt(budget))
				throw new AppError(
					"insufficient_balance",
					"预付余额不足以预留本次最大费用，请先充值。",
					402,
				);
			for (const route of model.routes) {
				const listing = route.listing;
				if (
					listing.kind !== "gateway" ||
					!resourceAvailable(listing) ||
					listing.inputRate > model.inputRate ||
					listing.outputRate > model.outputRate
				)
					continue;
				const acquired = await tx.$queryRaw<
					{ locked: boolean }[]
				>`SELECT pg_try_advisory_xact_lock(hashtext(${listing.id})) AS locked`;
				if (!acquired[0]?.locked) continue;
				if (listing.transport === "direct") {
					try {
						await requireGatewayAccess(listing.baseUrl ?? "", listing.proxyUrl);
					} catch (error) {
						if (
							error instanceof AppError &&
							error.code === "connector_not_allowed"
						)
							continue;
						throw error;
					}
				}
				const running = await tx.meterRequest.count({
					where: { status: "RUNNING", session: { listingId: listing.id } },
				});
				const opening = await tx.lease.count({
					where: {
						listingId: listing.id,
						fundingSource: "PREPAID",
						status: { in: ["PREPARING", "ACTIVE"] },
						requests: { none: {} },
					},
				});
				if (running + opening >= listing.concurrency) continue;
				const id = `0x${owner.slice(2).toLowerCase()}${randomBytes(12).toString("hex")}`;
				const expiresAt = new Date(
					(Math.floor(Date.now() / 1000) + 3600) * 1000,
				);
				const terms = {
					model: model.id,
					listingId: listing.id,
					provider: listing.owner,
					upstreamModel: listing.model,
					inputRate: model.inputRate,
					outputRate: model.outputRate,
					providerInputRate: listing.inputRate,
					providerOutputRate: listing.outputRate,
					feeBps: 500,
					asset: assetOf(config),
					tokenDecimals: decimalsOf(config),
					chainId: config.chainId,
					escrow: config.escrow,
					version: 4,
				};
				const created = await tx.lease.create({
					data: {
						id,
						listingId: listing.id,
						consumer: owner,
						provider: listing.owner,
						model: model.id,
						upstreamModel: listing.model,
						inputRate: model.inputRate,
						outputRate: model.outputRate,
						providerInputRate: listing.inputRate,
						providerOutputRate: listing.outputRate,
						termsHash: keccak256(stringToHex(JSON.stringify(terms))),
						budget,
						expiresAt,
						fundingSource: "PREPAID",
						status: "PREPARING",
					},
				});
				await tx.routedInvocation.create({
					data: {
						accessKeyId: key.id,
						modelId: model.id,
						sessionId: id,
						idempotencyKey: input.idempotencyKey,
					},
				});
				return created;
			}
			throw new AppError(
				"model_capacity",
				"该模型暂无可用上游，请稍后重试。",
				429,
			);
		},
		{ timeout: 30_000, maxWait: 10_000 },
	);
	try {
		const openTx = await sendPrepaidReserve(lease);
		const transition = await db.lease.updateMany({
			where: { id: lease.id, status: "PREPARING" },
			data: { status: "ACTIVE", openTx },
		});
		if (transition.count !== 1)
			throw new AppError(
				"reservation_recovered",
				"预留操作已进入恢复处理，本次不会调用上游。",
				409,
			);
	} catch (error) {
		await rejectUnsentPrepaidReservation(lease.id);
		if (error instanceof AppError) throw error;
		throw new AppError(
			"reservation_pending",
			"资金预留尚未确认；尚未调用上游。请核对原请求，不要换幂等键重发。",
			503,
		);
	}
	try {
		if (signal?.aborted)
			throw new AppError("aborted", "请求已取消，预留资金将退回账户。", 499);
		return await runChat(
			owner,
			{
				sessionId: lease.id,
				messages: input.messages,
				maxTokens: input.maxTokens,
				conversationId: input.conversationId,
				idempotencyKey: input.idempotencyKey,
			},
			onDelta,
			signal,
			input.keyId,
		);
	} finally {
		await db.lease.updateMany({
			where: { id: lease.id, status: "ACTIVE" },
			data: { status: "CLOSING" },
		});
	}
}

/** Recovery never repeats inference. It only completes/returns persisted funds. */
export async function recoverPrepaidReservations() {
	const cutoff = new Date(Date.now() - 120_000);
	const leases = await db.lease.findMany({
		where: {
			fundingSource: "PREPAID",
			status: { in: ["PREPARING", "ACTIVE"] },
			createdAt: { lt: cutoff },
			requests: { none: {} },
		},
		orderBy: { createdAt: "asc" },
		take: 25,
	});
	for (const lease of leases) {
		try {
			const job = await db.chainTransaction.findUnique({
				where: { id: `prepaid-open:${lease.id}` },
			});
			if (!job || job.status === "REVERTED") {
				await rejectUnsentPrepaidReservation(lease.id);
				continue;
			}
			const openTx = await sendPrepaidReserve(lease);
			await db.lease.updateMany({
				where: { id: lease.id, status: { in: ["PREPARING", "ACTIVE"] } },
				data: { status: "CLOSING", openTx },
			});
		} catch {
			await rejectUnsentPrepaidReservation(lease.id);
		}
	}
	await db.lease.updateMany({
		where: {
			fundingSource: "PREPAID",
			status: "ACTIVE",
			createdAt: { lt: cutoff },
		},
		data: { status: "CLOSING" },
	});
}
