import { ensureChainBinding } from "./runtime";
import "server-only";
import { createHash } from "node:crypto";
import { unsealData } from "iron-session";
import type { z } from "zod";
import { db } from "~/server/db";
import type { ChatResult } from "~/shared/token2api";
import { AppError } from "./auth";
import { readEscrowPaused, readSession } from "./chain";
import { resourceAvailable } from "./connector-availability";
import { readProxy, requireGatewayAccess } from "./gateway-access";
import { withGatewayTransport } from "./gateway-transport";
import { runLocalConnector } from "./local-connector";
import { lock } from "./market";
import { EngineFailure, runEngine } from "./pool-engine";
import { demoEnabled, sessionPassword } from "./runtime";
import type { chatInput } from "./token2api.schema";

export function calculateCost(
	input: number,
	output: number,
	inputRate: number,
	outputRate: number,
): number {
	if (
		![input, output, inputRate, outputRate].every(
			(n) => Number.isSafeInteger(n) && n >= 0,
		)
	)
		throw new AppError("invalid_amount", "计费参数必须是非负安全整数。");
	const amount =
		(BigInt(input) * BigInt(inputRate) +
			BigInt(output) * BigInt(outputRate) +
			999999n) /
		1000000n;
	if (amount > BigInt(Number.MAX_SAFE_INTEGER))
		throw new AppError("overflow", "费用超出支持范围。");
	return Number(amount);
}
type ChatArgs = z.infer<typeof chatInput>;
type SessionState = Awaited<ReturnType<typeof readSession>>;
const SESSION_STATE_TTL_MS = 1000;
const sessionStates = new Map<
	string,
	{ expires: number; state: Promise<SessionState> }
>();
/**
 * Admission-only chain read. Concurrent calls share one RPC request and reuse it
 * briefly; the database lease status is still checked under the lease lock.
 */
function admissionSessionState(id: string): Promise<SessionState> {
	const now = Date.now();
	// Entries share one TTL, so insertion order is expiry order.
	for (const [key, entry] of sessionStates) {
		if (entry.expires > now) break;
		sessionStates.delete(key);
	}
	const cached = sessionStates.get(id);
	if (cached) return cached.state;
	const state = readSession(id);
	sessionStates.set(id, { expires: now + SESSION_STATE_TTL_MS, state });
	state.catch(() => sessionStates.delete(id));
	return state;
}
/** Test hook: drop cached admission reads. */
export function resetAdmissionCache() {
	sessionStates.clear();
}
export async function runChat(
	owner: string,
	input: ChatArgs,
	onDelta: (s: string) => void | Promise<void> = () => undefined,
	signal?: AbortSignal,
	accessKeyId?: string,
): Promise<ChatResult> {
	await ensureChainBinding();
	if (await readEscrowPaused())
		throw new AppError(
			"settlement_paused",
			"市场结算已暂停，暂不接受新调用。",
			503,
		);
	const lease = await db.lease.findUnique({
		where: { id: input.sessionId },
		include: { listing: true },
	});
	if (!lease || lease.consumer !== owner)
		throw new AppError("not_found", "调用会话不存在。", 404);
	if (lease.listing.kind === "demo" && !demoEnabled())
		throw new AppError("demo_disabled", "模拟引擎未启用。", 403);
	const chain = await admissionSessionState(lease.id);
	if (
		chain.closed ||
		chain.closeAfter ||
		chain.expiresAt * 1000 < Date.now() + 180_000
	)
		throw new AppError(
			"inactive_session",
			"会话正在关闭或接近到期，已停止接单。",
			409,
		);
	const kind =
		lease.listing.kind === "demo" ? ("demo" as const) : ("gateway" as const);
	const baseUrl =
		kind === "gateway" && lease.listing.transport !== "local"
			? await requireGatewayAccess(
					lease.listing.baseUrl ?? "",
					lease.listing.proxyUrl,
				)
			: undefined;
	const proxy =
		kind === "gateway" && lease.listing.transport !== "local"
			? await readProxy(lease.listing)
			: undefined;
	const secretValue = lease.listing.secret
		? await unsealData<unknown>(lease.listing.secret, {
				password: sessionPassword(),
				ttl: 0,
			})
		: undefined;
	const apiKey =
		typeof secretValue === "string" && secretValue.length > 0
			? secretValue
			: undefined;
	if (
		kind === "gateway" &&
		lease.listing.transport !== "local" &&
		(!baseUrl || !apiKey)
	)
		throw new AppError("connector_unconfigured", "上游连接器未配置。", 503);
	// Conservative admission ceiling for the text-only 24 KB input contract.
	// Usage above this reservation requires review and is never silently overcharged.
	const inputCeiling =
		kind === "demo"
			? input.messages.reduce(
					(n, m) => n + Math.max(1, Array.from(m.content).length),
					0,
				)
			: 32768;
	const reservation = calculateCost(
		inputCeiling,
		input.maxTokens,
		lease.inputRate,
		lease.outputRate,
	);
	const request = await db.$transaction(async (tx) => {
		await lock(tx, lease.listingId);
		await lock(tx, lease.id);
		if (accessKeyId) {
			const key = await tx.accessKey.findUnique({ where: { id: accessKeyId } });
			if (
				!key ||
				key.revoked ||
				key.owner !== owner ||
				key.sessionId !== lease.id
			)
				throw new AppError("unauthorized", "密钥已撤销。", 401);
		}
		const current = await tx.lease.findUniqueOrThrow({
			where: { id: lease.id },
		});
		const listing = await tx.listing.findUniqueOrThrow({
			where: { id: lease.listingId },
		});
		if (current.status !== "ACTIVE" || !resourceAvailable(listing))
			throw new AppError("inactive_session", "会话或资源已暂停。", 409);
		const duplicate = await tx.meterRequest.findUnique({
			where: {
				sessionId_idempotencyKey: {
					sessionId: lease.id,
					idempotencyKey: input.idempotencyKey,
				},
			},
		});
		if (duplicate)
			throw new AppError(
				"duplicate_request",
				"此幂等请求已受理，不会再次调用或扣费。",
				409,
			);
		const active = await tx.meterRequest.count({
			where: { status: "RUNNING", session: { listingId: listing.id } },
		});
		if (active >= listing.concurrency)
			throw new AppError("capacity", "资源并发已满，请稍后重试。", 429);
		if (current.budget - current.spent - current.reserved < BigInt(reservation))
			throw new AppError(
				"insufficient_budget",
				"可用预算不足以预留本次最大费用。",
				402,
			);
		const row = await tx.meterRequest.create({
			data: {
				sessionId: lease.id,
				idempotencyKey: input.idempotencyKey,
				reservation,
			},
		});
		await tx.lease.update({
			where: { id: lease.id },
			data: { reserved: { increment: reservation } },
		});
		await tx.ledgerEntry.create({
			data: {
				sessionId: lease.id,
				requestId: row.id,
				kind: "RESERVE",
				amount: reservation,
			},
		});
		return row;
	});
	try {
		const conversationId = createHash("sha256")
			.update(`${owner}:${lease.listingId}:${input.conversationId}`)
			.digest("hex");
		const engineInput = {
			kind,
			baseUrl,
			apiKey,
			model: lease.model,
			messages: input.messages,
			maxTokens: input.maxTokens,
			conversationId,
		};
		const executionSignal = signal
			? AbortSignal.any([signal, AbortSignal.timeout(45_000)])
			: AbortSignal.timeout(45_000);
		const result =
			lease.listing.transport === "local"
				? await runLocalConnector(
						lease.listingId,
						request.id,
						engineInput,
						onDelta,
						executionSignal,
					)
				: await withGatewayTransport(proxy, (fetcher) =>
						runEngine(engineInput, onDelta, executionSignal, fetcher),
					);

		const cost =
			result.inputTokens !== null && result.outputTokens !== null
				? calculateCost(
						result.inputTokens,
						result.outputTokens,
						lease.inputRate,
						lease.outputRate,
					)
				: null;
		if (result.pendingReview || cost === null || cost > reservation) {
			await db.$transaction(async (tx) => {
				await lock(tx, lease.id);
				const evidence = {
					usageSource: result.usageSource,
					inputTokens: result.inputTokens,
					outputTokens: result.outputTokens,
					upstreamId: result.upstreamRequestId,
					errorCode:
						cost !== null && cost > reservation
							? "reservation_exceeded"
							: "usage_missing",
				};
				const transition = await tx.meterRequest.updateMany({
					where: { id: request.id, status: "RUNNING" },
					data: { status: "REVIEW", ...evidence },
				});
				if (transition.count === 1) return;
				const late = await tx.meterRequest.updateMany({
					where: {
						id: request.id,
						status: "REVIEW",
						errorCode: "worker_interrupted",
					},
					data: evidence,
				});
				if (late.count !== 1)
					throw new AppError(
						"request_finalized",
						"请求已完成核对，迟到结果未更改账单。",
						409,
					);
			});
			throw new AppError(
				"usage_pending_review",
				"上游结果已返回，但用量需要核对；预算继续保留，尚未扣费。",
				409,
			);
		}
		const finalized = await db.$transaction(async (tx) => {
			await lock(tx, lease.id);
			const transition = await tx.meterRequest.updateMany({
				where: { id: request.id, status: "RUNNING" },
				data: {
					status: "COMPLETED",
					cost,
					inputTokens: result.inputTokens,
					outputTokens: result.outputTokens,
					usageSource: result.usageSource,
					upstreamId: result.upstreamRequestId,
				},
			});
			if (transition.count !== 1) {
				const late = await tx.meterRequest.updateMany({
					where: {
						id: request.id,
						status: "REVIEW",
						errorCode: "worker_interrupted",
					},
					data: {
						inputTokens: result.inputTokens,
						outputTokens: result.outputTokens,
						usageSource: result.usageSource,
						upstreamId: result.upstreamRequestId,
						errorCode: "late_usage_reported",
					},
				});
				if (late.count === 1) return false;
				throw new AppError(
					"request_finalized",
					"请求已完成核对，迟到结果未更改账单。",
					409,
				);
			}
			await tx.lease.update({
				where: { id: lease.id },
				data: {
					spent: { increment: cost },
					reserved: { decrement: reservation },
				},
			});
			await tx.ledgerEntry.createMany({
				data: [
					{
						sessionId: lease.id,
						requestId: request.id,
						kind: "CAPTURE",
						amount: cost,
					},
					{
						sessionId: lease.id,
						requestId: request.id,
						kind: "RELEASE",
						amount: reservation - cost,
					},
				],
			});
			return true;
		});
		if (!finalized)
			throw new AppError(
				"usage_pending_review",
				"迟到的上游用量已保存，预算继续保留等待核对。",
				409,
			);
		return {
			id: request.id,
			text: result.text,
			finishReason: result.finishReason,
			inputTokens: result.inputTokens || 0,
			outputTokens: result.outputTokens || 0,
			cost,
			usageSource: result.usageSource,
		};
	} catch (error) {
		if (
			error instanceof AppError &&
			["usage_pending_review", "request_finalized"].includes(error.code)
		)
			throw error;
		const uncertain = !(error instanceof EngineFailure) || error.pendingReview;
		await db.$transaction(async (tx) => {
			await lock(tx, lease.id);
			const transition = await tx.meterRequest.updateMany({
				where: { id: request.id, status: "RUNNING" },
				data: {
					status: uncertain ? "REVIEW" : "FAILED",
					errorCode:
						error instanceof EngineFailure ? error.code : "execution_unknown",
					upstreamId:
						error instanceof EngineFailure ? error.upstreamRequestId : null,
				},
			});
			if (transition.count !== 1) return;
			if (!uncertain) {
				await tx.lease.update({
					where: { id: lease.id },
					data: { reserved: { decrement: reservation } },
				});
				await tx.ledgerEntry.create({
					data: {
						sessionId: lease.id,
						requestId: request.id,
						kind: "RELEASE",
						amount: reservation,
					},
				});
			}
		});
		if (error instanceof EngineFailure && error.code === "authorization") {
			await db.listing.updateMany({
				where: { id: lease.listingId },
				data: { enabled: false, status: "AUTH_REQUIRED" },
			});
		}
		if (error instanceof EngineFailure)
			throw new AppError(error.code, error.message, error.status);
		throw new AppError(
			"execution_pending_review",
			"请求状态不确定，预算已保留等待核对。",
			502,
		);
	}
}
