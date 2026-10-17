import { escrowAbi } from "~/lib/abi";
import { ensureChainBinding } from "./runtime";
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { sealData } from "iron-session";
import { keccak256, parseEventLogs, stringToHex } from "viem";
import type { z } from "zod";
import { db } from "~/server/db";
import type { OpenSessionResult, Snapshot, Viewer } from "~/shared/mon2api";
import { AppError } from "./auth";
import {
	chainBalances,
	clients,
	demoOpen,
	demoWithdraw,
	readSession,
} from "./chain";
import type { listingInput, openSessionInput } from "./mon2api.schema";
import {
	chainConfig,
	demoEnabled,
	sessionPassword,
	validateConnectorUrl,
} from "./runtime";

export type Tx = Prisma.TransactionClient;
export async function lock(tx: Tx, id: string) {
	await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${id}))`;
}
export const keyHash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
export async function createListing(
	user: Viewer,
	input: z.infer<typeof listingInput>,
) {
	if (input.kind === "demo" && !demoEnabled())
		throw new AppError("demo_disabled", "真实环境不接受模拟资源。", 403);
	let baseUrl: string | null = null;
	if (input.kind === "gateway" && input.baseUrl) {
		try {
			baseUrl = validateConnectorUrl(input.baseUrl);
		} catch {
			throw new AppError(
				"connector_not_allowed",
				"请运营者先将上游 origin 加入 UPSTREAM_ALLOWED_ORIGINS。",
			);
		}
	}
	const secret = input.apiKey
		? await sealData(input.apiKey, { password: sessionPassword(), ttl: 0 })
		: null;
	return db.listing.create({
		data: {
			owner: user.address,
			name: input.name,
			description: input.description,
			model: input.model,
			kind: input.kind,
			inputRate: input.inputRate,
			outputRate: input.outputRate,
			concurrency: input.concurrency,
			baseUrl,
			secret,
		},
		select: { id: true },
	});
}
export async function toggleListing(
	user: Viewer,
	id: string,
	enabled: boolean,
) {
	const updated = await db.listing.updateMany({
		where: { id, owner: user.address },
		data: { enabled, status: enabled ? "READY" : "PAUSED" },
	});
	if (updated.count !== 1)
		throw new AppError("not_found", "资源不存在或不属于此钱包。", 404);
	return { ok: true };
}
export async function openSession(
	user: Viewer,
	input: z.infer<typeof openSessionInput>,
): Promise<OpenSessionResult> {
	await ensureChainBinding();
	const listing = await db.listing.findUnique({
		where: { id: input.listingId },
	});
	if (!listing?.enabled)
		throw new AppError("unavailable", "资源当前未上架。", 409);
	const id = `0x${randomBytes(32).toString("hex")}`;
	const expiresAt = Math.floor(Date.now() / 1000) + 3600;
	const termsHash = keccak256(
		stringToHex(
			JSON.stringify({
				listingId: listing.id,
				provider: listing.owner,
				model: listing.model,
				inputRate: listing.inputRate,
				outputRate: listing.outputRate,
				feeBps: 500,
				maxOutput: 2048,
				version: 1,
			}),
		),
	);
	await db.lease.create({
		data: {
			id,
			listingId: listing.id,
			consumer: user.address,
			provider: listing.owner,
			model: listing.model,
			inputRate: listing.inputRate,
			outputRate: listing.outputRate,
			termsHash,
			budget: input.budget,
			expiresAt: new Date(expiresAt * 1000),
		},
	});
	const transaction = {
		id,
		provider: listing.owner,
		termsHash,
		budget: input.budget,
		expiresAt,
	};
	if (user.demo) {
		const hash = await demoOpen(user.address, transaction);
		await confirmSession(user, id, hash);
		return { id, mode: "demo", txHash: hash, transaction };
	}
	return { id, mode: "wallet", transaction };
}
export async function confirmSession(user: Viewer, id: string, hash?: string) {
	const lease = await db.lease.findUnique({ where: { id } });
	if (!lease || lease.consumer !== user.address)
		throw new AppError("not_found", "会话不存在。", 404);
	if (hash) {
		const { config, publicClient } = clients();
		const receipt = await publicClient.waitForTransactionReceipt({
			hash: hash as `0x${string}`,
			confirmations: config.mode === "local" ? 1 : 6,
		});
		const opened = parseEventLogs({
			abi: escrowAbi,
			eventName: "SessionOpened",
			logs: receipt.logs,
		});
		if (
			!opened.some((event) => event.args.id.toLowerCase() === id.toLowerCase())
		)
			throw new AppError(
				"invalid_transaction",
				"交易没有创建此租赁会话。",
				409,
			);
		if (
			receipt.status !== "success" ||
			receipt.to?.toLowerCase() !== config.escrow.toLowerCase() ||
			receipt.from.toLowerCase() !== user.address
		)
			throw new AppError(
				"invalid_transaction",
				"交易与此钱包或合约不符。",
				409,
			);
	}
	const onchain = await readSession(id);
	if (
		onchain.closed ||
		onchain.closeAfter ||
		onchain.consumer.toLowerCase() !== user.address ||
		onchain.provider.toLowerCase() !== lease.provider ||
		onchain.termsHash !== lease.termsHash ||
		onchain.budget !== lease.budget ||
		onchain.expiresAt !== Math.floor(lease.expiresAt.getTime() / 1000)
	)
		throw new AppError(
			"unconfirmed",
			"链上会话尚未确认，或条款与报价不符。",
			409,
		);
	await db.lease.updateMany({
		where: { id, status: "DRAFT" },
		data: { status: "ACTIVE", openTx: hash },
	});
	return { id, status: "ACTIVE" };
}
export async function createKey(user: Viewer, sessionId: string, name: string) {
	const lease = await db.lease.findUnique({ where: { id: sessionId } });
	if (!lease || lease.consumer !== user.address || lease.status !== "ACTIVE")
		throw new AppError(
			"inactive_session",
			"只能为自己的活跃会话创建密钥。",
			409,
		);
	const key = `m2a_${randomBytes(32).toString("base64url")}`;
	await db.accessKey.create({
		data: {
			owner: user.address,
			sessionId,
			name,
			hash: keyHash(key),
			prefix: `${key.slice(0, 10)}…${key.slice(-4)}`,
		},
	});
	return { key };
}
export async function revokeKey(user: Viewer, id: string) {
	const result = await db.accessKey.updateMany({
		where: { id, owner: user.address },
		data: { revoked: true },
	});
	if (!result.count) throw new AppError("not_found", "密钥不存在。", 404);
	return { ok: true };
}
export async function authenticateKey(authorization: string | null) {
	const match = /^Bearer (m2a_[\w-]{43})$/.exec(authorization || "");
	if (!match?.[1])
		throw new AppError("unauthorized", "需要平台 Bearer API Key。", 401);
	const key = await db.accessKey.findUnique({
		where: { hash: keyHash(match[1]) },
	});
	if (!key || key.revoked)
		throw new AppError("unauthorized", "API Key 无效或已撤销。", 401);
	return key;
}
export async function withdraw(user: Viewer) {
	const balances = await chainBalances(user.address);
	if (!balances.claimable)
		throw new AppError("empty_balance", "当前没有可提现收入或退款。", 409);
	return user.demo
		? { mode: "demo" as const, txHash: await demoWithdraw(user.address) }
		: { mode: "wallet" as const };
}
export async function snapshot(user: Viewer | null): Promise<Snapshot> {
	const listingRows = await db.listing.findMany({
		orderBy: { createdAt: "asc" },
	});
	const leaseWhere = user
		? { OR: [{ consumer: user.address }, { provider: user.address }] }
		: { id: "__none__" };
	const [leases, requests, keys, settlements, running] = await Promise.all([
		db.lease.findMany({
			where: leaseWhere,
			include: { listing: true },
			orderBy: { createdAt: "desc" },
			take: 100,
		}),
		db.meterRequest.findMany({
			where: { session: leaseWhere },
			include: { session: { include: { listing: true } }, settlement: true },
			orderBy: { createdAt: "desc" },
			take: 200,
		}),
		db.accessKey.findMany({
			where: { owner: user?.address || "__none__" },
			orderBy: { createdAt: "desc" },
		}),
		db.settlement.findMany({
			where: { session: leaseWhere },
			orderBy: { createdAt: "desc" },
			take: 100,
		}),
		db.meterRequest.groupBy({
			by: ["sessionId"],
			where: { status: "RUNNING" },
			_count: true,
		}),
	]);
	let network: Snapshot["network"] = {
		mode: "local",
		name: "Local EVM",
		chainId: 31337,
		rpcUrl: "http://127.0.0.1:8545",
		escrow: "",
		token: "",
		feeBps: 500,
		ready: false,
		explorer: "",
	};
	let balances = { claimable: 0, walletBalance: 0 };
	try {
		const config = chainConfig();
		const { publicClient } = clients();
		const chainId = await publicClient.getChainId();
		network = {
			...network,
			mode: config.mode,
			name: config.mode === "local" ? "Local EVM" : "Monad Testnet",
			chainId,
			rpcUrl:
				config.mode === "local"
					? "http://127.0.0.1:8545"
					: "https://testnet-rpc.monad.xyz",
			escrow: config.escrow,
			token: config.token,
			ready: chainId === config.chainId,
			explorer:
				config.mode === "monad-testnet" ? "https://testnet.monadscan.com" : "",
		};
		if (user) balances = await chainBalances(user.address);
	} catch {
		/* A disconnected chain is shown explicitly; never fake balances. */
	}
	const counts = new Map(running.map((r) => [r.sessionId, r._count]));
	const allRunning = await db.lease.findMany({
		where: { id: { in: running.map((r) => r.sessionId) } },
		select: { id: true, listingId: true },
	});
	return {
		viewer: user,
		network,
		metrics: {
			requests: requests.length,
			inputTokens: requests.reduce((n, r) => n + (r.inputTokens || 0), 0),
			outputTokens: requests.reduce((n, r) => n + (r.outputTokens || 0), 0),
			spent: leases.reduce((n, s) => n + s.spent, 0),
			pending: leases.reduce((n, s) => n + s.spent - s.settled, 0),
			settled: leases.reduce((n, s) => n + s.settled, 0),
			...balances,
		},
		listings: listingRows.map((l) => ({
			id: l.id,
			name: l.name,
			description: l.description,
			model: l.model,
			owner: l.owner,
			kind: l.kind === "demo" ? "demo" : "gateway",
			enabled: l.enabled,
			inputRate: l.inputRate,
			outputRate: l.outputRate,
			concurrency: l.concurrency,
			activeRequests: allRunning
				.filter((s) => s.listingId === l.id)
				.reduce((n, s) => n + (counts.get(s.id) || 0), 0),
			status: l.status,
			createdAt: l.createdAt.toISOString(),
		})),
		sessions: leases.map((s) => ({
			id: s.id,
			listingId: s.listingId,
			listingName: s.listing.name,
			model: s.model,
			consumer: s.consumer,
			provider: s.provider,
			budget: s.budget,
			spent: s.spent,
			reserved: s.reserved,
			settled: s.settled,
			status: s.status,
			expiresAt: s.expiresAt.toISOString(),
			openTx: s.openTx,
			closeTx: s.closeTx,
		})),
		requests: requests.map((r) => ({
			id: r.id,
			sessionId: r.sessionId,
			listingName: r.session.listing.name,
			model: r.session.model,
			status: r.status,
			inputTokens: r.inputTokens || 0,
			outputTokens: r.outputTokens || 0,
			cost: r.cost,
			usageSource: r.usageSource,
			upstreamRequestId: r.upstreamId,
			createdAt: r.createdAt.toISOString(),
			settled: r.settlement?.status === "CONFIRMED",
		})),
		keys: keys.map((k) => ({
			id: k.id,
			name: k.name,
			prefix: k.prefix,
			sessionId: k.sessionId,
			revoked: k.revoked,
			createdAt: k.createdAt.toISOString(),
		})),
		settlements: settlements.map((s) => ({
			id: s.id,
			sessionId: s.sessionId,
			amount: s.amount,
			status: s.status,
			txHash: s.txHash,
			createdAt: s.createdAt.toISOString(),
		})),
	};
}
