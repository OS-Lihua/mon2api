import { ensureChainBinding } from "./runtime";
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { sealData } from "iron-session";
import { getAddress, keccak256, stringToHex } from "viem";
import type { z } from "zod";
import { db } from "~/server/db";
import type { GatewayProxy } from "~/shared/gateway-config";
import type { modelKeyInput } from "~/shared/model-routing";
import { DEFAULT_NETWORK, networkMetadata } from "~/shared/network";
import {
	assetOf,
	balanceUnit,
	billingUnit,
	decimalsOf,
	toChainAmount,
} from "~/shared/settlement-asset";
import type {
	BuyerConnection,
	OpenSessionResult,
	Snapshot,
	Viewer,
} from "~/shared/token2api";
import { AppError } from "./auth";
import {
	chainBalances,
	clients,
	demoOpen,
	demoWithdraw,
	findSessionOpen,
	readEscrowPaused,
	readSession,
} from "./chain";
import { connectorOnline, resourceAvailable } from "./connector-availability";
import { assertEscrowOwnerGuard } from "./escrow-version";
import { requireGatewayAccess, sealProxy } from "./gateway-access";
import { withGatewayTransport } from "./gateway-transport";
import { ledgerAmount } from "./ledger";
import { requireModels } from "./model-catalog";
import { discoverModels } from "./model-discovery";
import { chainConfig, demoEnabled, sessionPassword } from "./runtime";
import type {
	listingInput,
	listingUpdateInput,
	openSessionInput,
} from "./token2api.schema";

type Tx = Prisma.TransactionClient;
export async function lock(tx: Tx, id: string) {
	await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${id}))`;
}
const keyHash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
export async function discoverDirectModels(input: {
	baseUrl: string;
	apiKey: string;
	proxy?: GatewayProxy;
}) {
	const baseUrl = await requireGatewayAccess(input.baseUrl, input.proxy?.url);
	try {
		return {
			models: await withGatewayTransport(input.proxy, (fetcher) =>
				discoverModels(baseUrl, input.apiKey, fetcher),
			),
		};
	} catch {
		throw new AppError(
			"discovery_failed",
			"读取模型失败，请检查网关 API 基础地址、调用 Key 和模型列表接口。",
			400,
		);
	}
}
export async function createListing(
	user: Viewer,
	input: z.infer<typeof listingInput>,
) {
	if (input.kind === "demo" && !demoEnabled())
		throw new AppError("demo_disabled", "真实环境不接受模拟资源。", 403);
	let baseUrl: string | null = null;
	if (input.kind === "gateway" && input.baseUrl) {
		baseUrl = await requireGatewayAccess(input.baseUrl, input.proxy?.url);
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
			...(await sealProxy(input.proxy)),
		},
		select: { id: true },
	});
}
export async function toggleListing(
	user: Viewer,
	id: string,
	enabled: boolean,
) {
	if (enabled) {
		const listing = await db.listing.findUnique({ where: { id } });
		if (!listing || listing.owner !== user.address)
			throw new AppError("not_found", "资源不存在或不属于此钱包。", 404);
		if (listing.kind === "gateway" && listing.transport === "direct")
			await requireGatewayAccess(listing.baseUrl ?? "", listing.proxyUrl);
	}
	const updated = await db.listing.updateMany({
		where: { id, owner: user.address, status: { not: "DISCOVERING" } },
		data: { enabled, status: enabled ? "READY" : "PAUSED" },
	});
	if (updated.count !== 1)
		throw new AppError("not_found", "资源不存在或不属于此钱包。", 404);
	return { ok: true };
}
export async function updateListing(
	user: Viewer,
	id: string,
	input: z.infer<typeof listingUpdateInput>,
) {
	if (input.concurrency !== undefined && input.concurrency > 1) {
		const resource = await db.listing.findUnique({
			where: { id },
			select: { owner: true, transport: true },
		});
		if (resource?.owner === user.address && resource.transport === "local")
			throw new AppError(
				"invalid_concurrency",
				"本机连接器当前只支持单并发。",
				400,
			);
	}

	const updated = await db.listing.updateMany({
		where: { id, owner: user.address },
		data: input,
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
	if (await readEscrowPaused())
		throw new AppError(
			"settlement_paused",
			"市场结算已暂停，暂不能开通预算。",
			503,
		);
	const { config, publicClient } = clients();
	try {
		await assertEscrowOwnerGuard(
			publicClient,
			getAddress(config.escrow),
			getAddress(user.address),
		);
	} catch {
		throw new AppError(
			"unsupported_escrow",
			"托管合约无法验证会话 ID 所有权，请检查链上部署。",
			503,
		);
	}
	const listing = await db.listing.findUnique({
		where: { id: input.listingId },
	});
	if (!listing || !resourceAvailable(listing))
		throw new AppError("unavailable", "资源当前未上架。", 409);
	if (listing.kind === "gateway" && listing.transport === "direct")
		await requireGatewayAccess(listing.baseUrl ?? "", listing.proxyUrl);
	const id = `0x${user.address.slice(2).toLowerCase()}${randomBytes(12).toString("hex")}`;
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
				version: 3,
				asset: assetOf(config),
				unit: billingUnit(assetOf(config)),
				tokenDecimals: decimalsOf(config),
				chainId: config.chainId,
				escrow: config.escrow.toLowerCase(),
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
		const confirmed = await confirmSession(user, id, hash, true);
		return {
			id,
			mode: "demo",
			txHash: hash,
			transaction,
			...(confirmed.connection ? { connection: confirmed.connection } : {}),
		};
	}
	return { id, mode: "wallet", transaction };
}
export async function confirmSession(
	user: Viewer,
	id: string,
	hash?: string,
	issueConnection = false,
) {
	await ensureChainBinding();
	const lease = await db.lease.findUnique({ where: { id } });
	if (!lease || lease.consumer !== user.address)
		throw new AppError("not_found", "会话不存在。", 404);
	const opened = await findSessionOpen(id, hash as `0x${string}` | undefined);
	if (!opened) throw new AppError("unconfirmed", "链上开通交易尚未确认。", 409);
	const { event, receipt } = opened;
	if (
		event.args.consumer.toLowerCase() !== user.address.toLowerCase() ||
		event.args.provider.toLowerCase() !== lease.provider.toLowerCase() ||
		event.args.termsHash.toLowerCase() !== lease.termsHash.toLowerCase() ||
		event.args.budget !==
			toChainAmount(
				lease.budget,
				assetOf(chainConfig()),
				decimalsOf(chainConfig()),
			) ||
		event.args.expiresAt !==
			BigInt(Math.floor(lease.expiresAt.getTime() / 1000))
	)
		throw new AppError("invalid_transaction", "开通交易与租赁条款不符。", 409);
	const onchain = await readSession(id);
	if (
		onchain.closed ||
		onchain.closeAfter ||
		onchain.consumer.toLowerCase() !== user.address.toLowerCase() ||
		onchain.provider.toLowerCase() !== lease.provider.toLowerCase() ||
		onchain.termsHash.toLowerCase() !== lease.termsHash.toLowerCase() ||
		BigInt(onchain.budget) !== lease.budget ||
		onchain.expiresAt !== Math.floor(lease.expiresAt.getTime() / 1000)
	)
		throw new AppError(
			"unconfirmed",
			"链上会话尚未确认，或条款与报价不符。",
			409,
		);
	if (!issueConnection) {
		await db.lease.updateMany({
			where: { id, status: "DRAFT" },
			data: { status: "ACTIVE", openTx: receipt.transactionHash },
		});
		return { id, status: "ACTIVE" as const };
	}
	// Activation and initial key are atomic. A confirmation replay never mints another key.
	const key = newApiKey();
	const connection = buyerConnection(key, lease.model);
	const issued = await db.$transaction(async (tx) => {
		await lock(tx, id);
		const changed = await tx.lease.updateMany({
			where: { id, status: "DRAFT" },
			data: { status: "ACTIVE", openTx: receipt.transactionHash },
		});
		if (changed.count !== 1) return false;
		await tx.accessKey.create({ data: keyData(user, id, "初始调用密钥", key) });
		return true;
	});
	return {
		id,
		status: "ACTIVE" as const,
		connection: issued ? connection : undefined,
	};
}
function newApiKey() {
	return `t2a_${randomBytes(32).toString("base64url")}`;
}
function buyerConnection(key: string, model: string): BuyerConnection {
	const origin = new URL(process.env.APP_ORIGIN || "http://localhost:3000");
	if (
		origin.username ||
		origin.password ||
		!["http:", "https:"].includes(origin.protocol) ||
		(origin.protocol !== "https:" &&
			!["localhost", "127.0.0.1"].includes(origin.hostname))
	)
		throw new AppError(
			"invalid_origin",
			"APP_ORIGIN 必须是平台 HTTPS 地址或本地回环地址。",
			503,
		);
	return { base_url: `${origin.origin}/v1`, key, model };
}
function keyData(user: Viewer, sessionId: string, name: string, key: string) {
	return {
		owner: user.address,
		sessionId,
		name,
		hash: keyHash(key),
		prefix: `${key.slice(0, 10)}…${key.slice(-4)}`,
	};
}

export async function createKey(user: Viewer, sessionId: string, name: string) {
	const lease = await db.lease.findUnique({ where: { id: sessionId } });
	if (!lease || lease.consumer !== user.address || lease.status !== "ACTIVE")
		throw new AppError(
			"inactive_session",
			"只能为自己的活跃会话创建密钥。",
			409,
		);
	const key = newApiKey();
	await db.accessKey.create({
		data: {
			owner: user.address,
			sessionId,
			name,
			hash: keyHash(key),
			prefix: `${key.slice(0, 10)}…${key.slice(-4)}`,
		},
	});
	return buyerConnection(key, lease.model);
}
export async function createModelKey(
	user: Viewer,
	input: z.infer<typeof modelKeyInput>,
) {
	const first = input.models[0];
	if (!first)
		throw new AppError("invalid_models", "至少选择一个允许使用的模型。", 400);
	await requireModels(input.models);
	const key = newApiKey();
	await db.accessKey.create({
		data: {
			owner: user.address,
			sessionId: null,
			name: input.name,
			models: input.models,
			hash: keyHash(key),
			prefix: `${key.slice(0, 10)}…${key.slice(-4)}`,
		},
	});
	return { ...buyerConnection(key, first), models: input.models };
}
export async function updateKeyModels(
	user: Viewer,
	id: string,
	models: string[],
) {
	if (!models.length)
		throw new AppError("invalid_models", "至少选择一个允许使用的模型。", 400);
	const key = await db.accessKey.findUnique({ where: { id } });
	if (
		!key ||
		key.revoked ||
		key.owner !== user.address ||
		key.sessionId !== null
	)
		throw new AppError(
			"not_found",
			"模型密钥不存在、已撤销或不属于当前钱包。",
			404,
		);
	await requireModels(models.filter((model) => !key.models.includes(model)));
	const updated = await db.accessKey.updateMany({
		where: { id, owner: user.address, sessionId: null, revoked: false },
		data: { models },
	});
	if (!updated.count)
		throw new AppError(
			"not_found",
			"模型密钥不存在、已撤销或不属于当前钱包。",
			404,
		);
	return { ok: true as const };
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
	const match = /^Bearer (t2a_[\w-]{43})$/.exec(authorization || "");
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
	if (BigInt(balances.claimable) === 0n)
		throw new AppError("empty_balance", "当前没有可提现收入或退款。", 409);
	return user.demo
		? { mode: "demo" as const, txHash: await demoWithdraw(user.address) }
		: { mode: "wallet" as const };
}
const CHAIN_READY_TTL_MS = 30_000;
const chainReady = new WeakMap<
	object,
	{ chainId: number; expires: number; ready: Promise<boolean> }
>();
/** Dashboard-only RPC health check, shared across polling clients. */
function chainReachable(chainId: number): Promise<boolean> {
	const { publicClient } = clients();
	const cached = chainReady.get(publicClient);
	if (cached?.chainId === chainId && cached.expires > Date.now())
		return cached.ready;
	const ready = publicClient.getChainId().then((id) => id === chainId);
	const entry = {
		chainId,
		expires: Date.now() + CHAIN_READY_TTL_MS,
		ready,
	};
	chainReady.set(publicClient, entry);
	ready.catch(() => {
		if (chainReady.get(publicClient) === entry) chainReady.delete(publicClient);
	});
	return ready;
}
export async function snapshot(
	user: Viewer | null,
	gatewayOnly = false,
): Promise<Snapshot> {
	if (gatewayOnly && user?.demo) user = null;
	const listingRows = await db.listing.findMany({
		where: {
			...(gatewayOnly ? { kind: "gateway" } : {}),
			OR: [
				{ status: { not: "DISCOVERING" } },
				...(user ? [{ owner: user.address }] : []),
			],
		},
		orderBy: { createdAt: "asc" },
	});
	const leaseWhere = user
		? {
				OR: [{ consumer: user.address }, { provider: user.address }],
				...(gatewayOnly ? { listing: { kind: "gateway" } } : {}),
			}
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
			where: {
				owner: user?.address || "__none__",
				...(gatewayOnly
					? {
							OR: [
								{ sessionId: null },
								{ session: { listing: { kind: "gateway" } } },
							],
						}
					: {}),
			},
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
		...DEFAULT_NETWORK,
		ledgerUnit: "micro_USDC",
		balanceUnit: "atomic",
		escrow: "",
		token: "",
		feeBps: 500,
		ready: false,
	};
	let balances: Pick<Snapshot["metrics"], "claimable" | "walletBalance"> = {
		claimable: null,
		walletBalance: null,
	};
	try {
		const config = chainConfig();
		network = {
			...network,
			asset: assetOf(config),
			ledgerUnit: billingUnit(assetOf(config)),
			balanceUnit: balanceUnit(assetOf(config)),
			tokenDecimals: decimalsOf(config),
			mode: config.mode,
			name: networkMetadata(config).name,
			chainId: config.chainId,
			rpcUrl: networkMetadata(config).rpcUrl,
			escrow: config.escrow,
			token: config.token,
			explorer: networkMetadata(config).explorer,
		};
		network.ready = await chainReachable(config.chainId);
		if (user) balances = await chainBalances(user.address);
	} catch {
		/* A disconnected chain is shown explicitly; never fake balances. */
	}
	const allRunning = await db.lease.findMany({
		where: { id: { in: running.map((r) => r.sessionId) } },
		select: { id: true, listingId: true },
	});
	const sessionListing = new Map(allRunning.map((s) => [s.id, s.listingId]));
	const activeByListing = new Map<string, number>();
	for (const r of running) {
		const listingId = sessionListing.get(r.sessionId);
		if (listingId)
			activeByListing.set(
				listingId,
				(activeByListing.get(listingId) ?? 0) + r._count,
			);
	}
	return {
		viewer: user,
		network,
		metrics: {
			requests: requests.length,
			inputTokens: requests.reduce((n, r) => n + (r.inputTokens || 0), 0),
			outputTokens: requests.reduce((n, r) => n + (r.outputTokens || 0), 0),
			spent: ledgerAmount(leases.reduce((n, s) => n + s.spent, 0n)),
			pending: ledgerAmount(
				leases.reduce((n, s) => n + s.spent - s.settled - s.writtenOff, 0n),
			),
			settled: ledgerAmount(leases.reduce((n, s) => n + s.settled, 0n)),
			writtenOff: ledgerAmount(leases.reduce((n, s) => n + s.writtenOff, 0n)),
			...balances,
		},
		listings: listingRows.map((l) => ({
			id: l.id,
			name: l.name,
			description: l.description,
			model: l.model,
			owner: l.owner,
			kind: l.kind === "demo" ? "demo" : "gateway",
			transport: l.transport === "local" ? "local" : "direct",
			online: connectorOnline(l),
			enabled: l.enabled,
			inputRate: l.inputRate,
			outputRate: l.outputRate,
			concurrency: l.concurrency,
			activeRequests: activeByListing.get(l.id) ?? 0,
			status:
				l.status !== "DISCOVERING" &&
				l.transport === "local" &&
				!connectorOnline(l)
					? "OFFLINE"
					: l.status,
			createdAt: l.createdAt.toISOString(),
		})),
		sessions: leases.map((s) => ({
			id: s.id,
			listingId: s.listingId,
			listingName: s.listing.name,
			model: s.model,
			consumer: s.consumer,
			provider: s.provider,
			fundingSource: s.fundingSource,
			budget: ledgerAmount(s.budget),
			spent: ledgerAmount(s.spent),
			reserved: ledgerAmount(s.reserved),
			settled: ledgerAmount(s.settled),
			writtenOff: ledgerAmount(s.writtenOff),
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
			inputTokens: r.inputTokens,
			outputTokens: r.outputTokens,
			cost: ledgerAmount(r.cost),
			providerCost: ledgerAmount(
				r.session.fundingSource === "PREPAID" ? r.providerCost : r.cost,
			),
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
			models: k.models,
			revoked: k.revoked,
			createdAt: k.createdAt.toISOString(),
		})),
		settlements: settlements.map((s) => ({
			id: s.id,
			sessionId: s.sessionId,
			amount: ledgerAmount(s.amount),
			status: s.status,
			txHash: s.txHash,
			createdAt: s.createdAt.toISOString(),
		})),
	};
}
