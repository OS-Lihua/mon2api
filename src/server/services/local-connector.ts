import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { db } from "~/server/db";
import {
	CONNECTOR_JOB_MS,
	connectorFailure,
	connectorPayload,
	connectorResult,
	type connectorUpdate,
} from "~/shared/connector";
import { modelCatalog } from "~/shared/model-catalog";
import type { Viewer } from "~/shared/mon2api";
import { AppError } from "./auth";
import { connectorOnline, resourceAvailable } from "./connector-availability";
import type {
	localDraftInput,
	localListingInput,
	publishLocalInput,
} from "./local-connector.schema";
import {
	EngineFailure,
	type EngineInput,
	type EngineResult,
} from "./pool-engine";

const hash = (token: string) =>
	createHash("sha256").update(token).digest("hex");
async function lock(tx: Prisma.TransactionClient, id: string) {
	await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${id}))`;
}
export async function createConnectorLaunch(user: Viewer, id: string) {
	const code = `m2l_${randomBytes(32).toString("base64url")}`;
	const expiresAt = new Date(Date.now() + 5 * 60_000);
	const result = await db.listing.updateMany({
		where: { id, owner: user.address, transport: "local" },
		data: {
			connectorLaunchHash: hash(code),
			connectorLaunchExpiresAt: expiresAt,
		},
	});
	if (result.count !== 1)
		throw new AppError("not_found", "本机资源不存在或不属于此钱包。", 404);
	return { code, expiresAt: expiresAt.toISOString() };
}
export async function redeemConnectorLaunch(authorization: string | null) {
	const match = /^Bearer (m2l_[\w-]{43})$/.exec(authorization ?? "");
	if (!match?.[1])
		throw new AppError("unauthorized", "需要一次性启动码。", 401);
	const launchHash = hash(match[1]);
	const row = await db.listing.findUnique({
		where: { connectorLaunchHash: launchHash },
	});
	if (row?.transport !== "local")
		throw new AppError(
			"unauthorized",
			"启动码无效、已使用或已过期，请重新复制启动命令。",
			401,
		);
	return db.$transaction(async (tx) => {
		await lock(tx, row.id);
		const token = `m2c_${randomBytes(32).toString("base64url")}`;
		// Consume the code and replace the previous connection in one atomic write.
		const changed = await tx.listing.updateMany({
			where: {
				id: row.id,
				transport: "local",
				connectorLaunchHash: launchHash,
				connectorLaunchExpiresAt: { gt: new Date() },
			},
			data: {
				connectorLaunchHash: null,
				connectorLaunchExpiresAt: null,
				connectorHash: hash(token),
				connectorSeenAt: null,
				connectorCatalog: Prisma.DbNull,
				connectorCatalogAt: null,
			},
		});
		if (changed.count !== 1)
			throw new AppError(
				"unauthorized",
				"启动码已使用或已过期，请重新复制启动命令。",
				401,
			);
		return { token };
	});
}
export async function createLocalDraft(
	user: Viewer,
	input: z.infer<typeof localDraftInput>,
) {
	const token = `m2c_${randomBytes(32).toString("base64url")}`;
	const row = await db.listing.create({
		data: {
			...input,
			owner: user.address,
			transport: "local",
			connectorHash: hash(token),
			model: "",
			inputRate: 1,
			outputRate: 1,
			enabled: false,
			status: "DISCOVERING",
		},
		select: { id: true },
	});
	return { id: row.id, token };
}
export async function connectorSetup(user: Viewer, id: string) {
	const row = await db.listing.findUnique({ where: { id } });
	if (!row || row.owner !== user.address || row.transport !== "local")
		throw new AppError("not_found", "本机资源不存在或不属于此钱包。", 404);
	return {
		id,
		model: row.model,
		status: row.status,
		online: connectorOnline(row),
		models: modelCatalog.parse(row.connectorCatalog ?? []),
	};
}
export async function reportConnectorCatalog(
	authorization: string | null,
	models: string[],
) {
	const { listing, credentialHash } =
		await authenticateConnector(authorization);
	const updated = await db.listing.updateMany({
		where: { id: listing.id, connectorHash: credentialHash },
		data: {
			connectorCatalog: modelCatalog.parse(models),
			connectorCatalogAt: new Date(),
		},
	});
	if (updated.count !== 1)
		throw new AppError("unauthorized", "连接器凭证已撤销。", 401);
	return { ok: true as const };
}
export async function publishLocalDraft(
	user: Viewer,
	input: z.infer<typeof publishLocalInput>,
) {
	return db.$transaction(async (tx) => {
		await lock(tx, input.id);
		const row = await tx.listing.findUnique({ where: { id: input.id } });
		if (!row || row.owner !== user.address || row.transport !== "local")
			throw new AppError("not_found", "本机资源不存在或不属于此钱包。", 404);
		if (
			row.status !== "DISCOVERING" ||
			(await tx.lease.count({ where: { listingId: row.id } }))
		)
			throw new AppError(
				"model_locked",
				"已上架资源的模型不可更改，请新建资源。",
				409,
			);
		if (
			!connectorOnline(row) ||
			!row.connectorCatalogAt ||
			row.connectorCatalogAt.getTime() < Date.now() - 120_000
		)
			throw new AppError(
				"connector_offline",
				"请启动连接器并重新读取模型列表。",
				409,
			);
		if (!modelCatalog.parse(row.connectorCatalog ?? []).includes(input.model))
			throw new AppError(
				"model_not_available",
				"请选择网关当前返回的模型。",
				409,
			);
		await tx.listing.update({
			where: { id: row.id },
			data: {
				model: input.model,
				inputRate: input.inputRate,
				outputRate: input.outputRate,
				enabled: true,
				status: "READY",
			},
		});
		return { ok: true as const };
	});
}
export async function createLocalListing(
	user: Viewer,
	input: z.infer<typeof localListingInput>,
) {
	const token = `m2c_${randomBytes(32).toString("base64url")}`;
	const row = await db.listing.create({
		data: {
			...input,
			owner: user.address,
			transport: "local",
			connectorHash: hash(token),
		},
		select: { id: true },
	});
	return { id: row.id, token };
}
export async function rotateConnector(user: Viewer, id: string) {
	const token = `m2c_${randomBytes(32).toString("base64url")}`;
	const updated = await db.$transaction(async (tx) => {
		await lock(tx, id);
		return tx.listing.updateMany({
			where: { id, owner: user.address, transport: "local" },
			data: {
				connectorHash: hash(token),
				connectorLaunchHash: null,
				connectorLaunchExpiresAt: null,
				connectorSeenAt: null,
				connectorCatalog: Prisma.DbNull,
				connectorCatalogAt: null,
			},
		});
	});
	if (updated.count !== 1)
		throw new AppError("not_found", "本机资源不存在或不属于此钱包。", 404);
	return { id, token };
}
export async function authenticateConnector(authorization: string | null) {
	const match = /^Bearer (m2c_[\w-]{43})$/.exec(authorization ?? "");
	if (!match?.[1])
		throw new AppError("unauthorized", "需要本机连接器凭证。", 401);
	const credentialHash = hash(match[1]);
	const listing = await db.listing.findUnique({
		where: { connectorHash: credentialHash },
	});
	if (listing?.transport !== "local")
		throw new AppError("unauthorized", "连接器凭证无效或已撤销。", 401);
	return { listing, credentialHash };
}
export async function connectorStatus(authorization: string | null) {
	const { listing } = await authenticateConnector(authorization);
	return {
		listingId: listing.id,
		model: listing.model,
		enabled: listing.enabled,
		online: connectorOnline(listing),
	};
}
export async function pollConnector(
	authorization: string | null,
	model?: string,
) {
	const { listing, credentialHash } =
		await authenticateConnector(authorization);
	if (model !== undefined && model !== listing.model)
		throw new AppError("model_mismatch", "本机模型与挂牌模型不一致。", 409);
	return db.$transaction(async (tx) => {
		await lock(tx, listing.id);
		const refreshed = await tx.listing.updateMany({
			where: { id: listing.id, connectorHash: credentialHash },
			data: { connectorSeenAt: new Date() },
		});
		if (refreshed.count !== 1)
			throw new AppError("unauthorized", "连接器凭证已撤销。", 401);
		const current = await tx.listing.findUniqueOrThrow({
			where: { id: listing.id },
		});
		const response = {
			listingId: listing.id,
			enabled: current.enabled,
			job: null,
		};
		if (!current.enabled || current.status === "DISCOVERING") return response;
		// Automatic clients can only serve a model actually reported by their gateway.
		if (
			model === undefined &&
			!modelCatalog
				.parse(current.connectorCatalog ?? [])
				.includes(current.model)
		)
			return response;
		// A claimed request is never redelivered, even after a lost poll response or restart.
		const busy = await tx.connectorJob.count({
			where: {
				listingId: listing.id,
				status: "CLAIMED",
				expiresAt: { gt: new Date() },
			},
		});
		if (busy) return response;
		const job = await tx.connectorJob.findFirst({
			where: {
				listingId: listing.id,
				status: "QUEUED",
				expiresAt: { gt: new Date() },
				request: { status: "RUNNING" },
			},
			orderBy: { createdAt: "asc" },
		});
		if (!job) return response;
		await tx.connectorJob.update({
			where: { id: job.id },
			data: { status: "CLAIMED", claimedBy: credentialHash },
		});
		return {
			...response,
			job: {
				id: job.id,
				input: connectorPayload.parse(job.payload),
				expiresAt: job.expiresAt.toISOString(),
			},
		};
	});
}
// Waiters in this process wake as soon as their job changes. Other instances
// fall back to polling, so correctness never depends on this signal.
const JOB_POLL_MS = 1000;
const jobWaiters = new Map<string, Set<() => void>>();
function wakeJob(id: string) {
	for (const wake of jobWaiters.get(id) ?? []) wake();
}
function waitForJob(id: string, signal: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		const waiters = jobWaiters.get(id) ?? new Set<() => void>();
		jobWaiters.set(id, waiters);
		const cleanup = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			waiters.delete(done);
			if (!waiters.size) jobWaiters.delete(id);
		};
		const done = () => {
			cleanup();
			resolve();
		};
		const abort = () => {
			cleanup();
			reject(signal.reason);
		};
		const timer = setTimeout(done, JOB_POLL_MS);
		waiters.add(done);
		if (signal.aborted) abort();
		else signal.addEventListener("abort", abort, { once: true });
	});
}
export async function updateConnector(
	authorization: string | null,
	input: z.infer<typeof connectorUpdate>,
) {
	if (Buffer.byteLength(input.text, "utf8") > 65536)
		throw new AppError("invalid_request", "响应内容过长。", 400);
	if (input.event === "complete" && input.result.text !== input.text)
		throw new AppError("invalid_request", "响应内容不一致。", 400);
	const { listing, credentialHash } =
		await authenticateConnector(authorization);
	const updated = await db.$transaction(async (tx) => {
		await lock(tx, listing.id);
		const current = await tx.listing.findUniqueOrThrow({
			where: { id: listing.id },
		});
		if (current.connectorHash !== credentialHash)
			throw new AppError("unauthorized", "连接器凭证已撤销。", 401);
		const job = await tx.connectorJob.findUnique({
			where: { id: input.jobId },
		});
		if (
			!job ||
			job.listingId !== listing.id ||
			job.claimedBy !== credentialHash
		)
			throw new AppError("not_found", "连接器任务不存在。", 404);
		if (input.revision <= job.revision) return { ok: true as const };
		if (job.status !== "CLAIMED" || job.expiresAt.getTime() <= Date.now())
			throw new AppError("job_expired", "任务已结束；不得再次调用上游。", 409);
		if (!input.text.startsWith(job.text))
			throw new AppError("invalid_request", "响应只能追加。", 409);
		await tx.connectorJob.update({
			where: { id: job.id },
			data: {
				text: input.text,
				revision: input.revision,
				...(input.event === "complete"
					? { status: "COMPLETE", result: input.result }
					: input.event === "failed"
						? { status: "FAILED", result: input.failure }
						: {}),
			},
		});
		if (input.event === "complete") {
			// Late usage is evidence, never an instruction to release an uncertain reservation.
			await tx.meterRequest.updateMany({
				where: { id: job.requestId, status: "REVIEW" },
				data: {
					inputTokens: input.result.inputTokens,
					outputTokens: input.result.outputTokens,
					usageSource: input.result.usageSource,
					upstreamId: input.result.upstreamRequestId,
					errorCode: "late_connector_usage",
				},
			});
		}

		await tx.listing.update({
			where: { id: listing.id },
			data: { connectorSeenAt: new Date() },
		});
		return { ok: true as const };
	});
	wakeJob(input.jobId);
	return updated;
}
export async function disconnectConnector(authorization: string | null) {
	const { listing, credentialHash } =
		await authenticateConnector(authorization);
	await db.listing.updateMany({
		where: { id: listing.id, connectorHash: credentialHash },
		data: { connectorSeenAt: null },
	});
	return { ok: true as const };
}
export async function runLocalConnector(
	listingId: string,
	requestId: string,
	input: EngineInput,
	onDelta: (text: string) => void | Promise<void>,
	signal: AbortSignal,
): Promise<EngineResult> {
	const payload = connectorPayload.parse({
		model: input.model,
		messages: input.messages,
		maxTokens: input.maxTokens,
		conversationId: input.conversationId,
	});
	const job = await db.$transaction(async (tx) => {
		await lock(tx, listingId);
		const listing = await tx.listing.findUniqueOrThrow({
			where: { id: listingId },
		});
		if (!resourceAvailable(listing))
			throw new EngineFailure(
				"upstream_unavailable",
				"本机连接器离线或已暂停。",
				503,
				false,
			);
		return tx.connectorJob.create({
			data: {
				listingId,
				requestId,
				payload,
				expiresAt: new Date(Date.now() + CONNECTOR_JOB_MS),
			},
		});
	});
	let emitted = "";
	try {
		while (!signal.aborted) {
			const row = await db.connectorJob.findUniqueOrThrow({
				where: { id: job.id },
			});
			if (row.text.length > emitted.length) {
				await onDelta(row.text.slice(emitted.length));
				emitted = row.text;
			}
			if (row.status === "COMPLETE") return connectorResult.parse(row.result);
			// Once claimed, even a reported upstream failure is uncertain to the platform.
			if (row.status === "FAILED") {
				const failure = connectorFailure.parse(row.result);
				throw new EngineFailure(
					failure.code,
					"本机上游调用失败，用量等待核对。",
					502,
					true,
					failure.upstreamRequestId,
				);
			}
			if (row.status === "CANCELLED")
				throw new EngineFailure("aborted", "本机任务已取消。", 409, true);
			if (row.expiresAt.getTime() <= Date.now()) break;
			await waitForJob(job.id, signal);
		}
	} catch (error) {
		if (error instanceof EngineFailure) throw error;
		if (!signal.aborted) throw error;
	}
	// Serialize cancellation with claiming so only unclaimed work can release its reservation.
	const cancelled = await db.$transaction(async (tx) => {
		await lock(tx, listingId);
		const queued = await tx.connectorJob.updateMany({
			where: { id: job.id, status: "QUEUED" },
			data: { status: "CANCELLED", payload: {} },
		});
		if (queued.count === 1) return true;
		// Claimed work cannot be redispatched. Keep its result available for manual reconciliation.
		return false;
	});
	throw new EngineFailure(
		"aborted",
		"本机连接中断或任务超时。",
		504,
		!cancelled,
	);
}
