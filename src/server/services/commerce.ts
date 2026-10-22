import "server-only";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { db } from "~/server/db";
import { networkMetadata } from "~/shared/network";
import {
	assetOf,
	balanceUnit,
	billingUnit,
	decimalsOf,
} from "~/shared/settlement-asset";
import type { Viewer } from "~/shared/token2api";
import { AppError } from "./auth";
import { chainBalances, clients } from "./chain";
import type {
	ledgerQuery,
	pageQuery,
	requestQuery,
	resourceQuery,
} from "./commerce.schema";
import { connectorOnline } from "./connector-availability";
import { ledgerAmount } from "./ledger";
import { chainConfig } from "./runtime";

type Page = z.infer<typeof pageQuery>;
type Side = "consumer" | "provider";
const resourceSelect = {
	id: true,
	owner: true,
	name: true,
	description: true,
	model: true,
	kind: true,
	transport: true,
	connectorSeenAt: true,
	connectorCatalog: true,
	inputRate: true,
	outputRate: true,
	concurrency: true,
	enabled: true,
	status: true,
	createdAt: true,
} satisfies Prisma.ListingSelect;
const sessionSelect = {
	id: true,
	listingId: true,
	consumer: true,
	provider: true,
	model: true,
	inputRate: true,
	outputRate: true,
	termsHash: true,
	budget: true,
	spent: true,
	reserved: true,
	settled: true,
	writtenOff: true,
	status: true,
	expiresAt: true,
	createdAt: true,
	openTx: true,
	closeTx: true,
} satisfies Prisma.LeaseSelect;
const requestSelect = {
	id: true,
	sessionId: true,
	status: true,
	inputTokens: true,
	outputTokens: true,
	reservation: true,
	cost: true,
	providerCost: true,
	session: { select: { fundingSource: true } },
	usageSource: true,
	upstreamId: true,
	errorCode: true,
	createdAt: true,
} satisfies Prisma.MeterRequestSelect;
const keySelect = {
	id: true,
	name: true,
	prefix: true,
	sessionId: true,
	revoked: true,
	models: true,
	createdAt: true,
} satisfies Prisma.AccessKeySelect;
const settlementSelect = {
	id: true,
	sessionId: true,
	nonce: true,
	amount: true,
	cumulative: true,
	receiptsHash: true,
	status: true,
	txHash: true,
	createdAt: true,
} satisfies Prisma.SettlementSelect;
function pagination(query: Page) {
	return {
		take: query.limit + 1,
		...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
		orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
	};
}
function page<T extends { id: string }>(rows: T[], limit: number) {
	const data = rows.slice(0, limit);
	const hasMore = rows.length > limit;
	return {
		data,
		hasMore,
		nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null,
	};
}
function resourceDto(
	row: Prisma.ListingGetPayload<{ select: typeof resourceSelect }>,
) {
	const { connectorSeenAt, connectorCatalog, ...resource } = row;
	return {
		...resource,
		online: connectorOnline(row),
		status:
			row.status !== "DISCOVERING" &&
			row.transport === "local" &&
			!connectorOnline(row)
				? "OFFLINE"
				: row.status,
		createdAt: row.createdAt.toISOString(),
	};
}
function sessionDto(
	row: Prisma.LeaseGetPayload<{ select: typeof sessionSelect }>,
) {
	return {
		...row,
		availableBudget: ledgerAmount(row.budget - row.spent - row.reserved),
		budget: ledgerAmount(row.budget),
		spent: ledgerAmount(row.spent),
		reserved: ledgerAmount(row.reserved),
		settled: ledgerAmount(row.settled),
		writtenOff: ledgerAmount(row.writtenOff),
		createdAt: row.createdAt.toISOString(),
		expiresAt: row.expiresAt.toISOString(),
	};
}
function requestDto(
	row: Prisma.MeterRequestGetPayload<{ select: typeof requestSelect }>,
) {
	const { upstreamId, createdAt, session, ...rest } = row;
	return {
		...rest,
		cost: ledgerAmount(row.cost),
		providerCost: ledgerAmount(
			session?.fundingSource === "PREPAID" ? row.providerCost : row.cost,
		),
		reservation: ledgerAmount(row.reservation),
		upstreamRequestId: upstreamId,
		createdAt: createdAt.toISOString(),
	};
}
export async function listResources(
	query: z.infer<typeof resourceQuery>,
	owner?: string,
) {
	const rows = await db.listing.findMany({
		where: {
			...(owner ? { owner } : { enabled: true }),
			...(query.kind ? { kind: query.kind } : {}),
			...(query.q
				? {
						OR: [
							{ name: { contains: query.q, mode: "insensitive" } },
							{ model: { contains: query.q, mode: "insensitive" } },
						],
					}
				: {}),
		},
		select: resourceSelect,
		...pagination(query),
	});
	return page(rows.map(resourceDto), query.limit);
}
export async function getResource(id: string, owner?: string) {
	const row = await db.listing.findFirst({
		where: { id, ...(owner ? { owner } : { enabled: true }) },
		select: resourceSelect,
	});
	if (!row) throw new AppError("not_found", "资源不存在或不可见。", 404);
	return resourceDto(row);
}
export async function listSessions(user: Viewer, query: Page) {
	const rows = await db.lease.findMany({
		where: { consumer: user.address },
		select: sessionSelect,
		...pagination(query),
	});
	return page(rows.map(sessionDto), query.limit);
}
export async function getConsumerSession(user: Viewer, id: string) {
	const row = await db.lease.findFirst({
		where: { id, consumer: user.address },
		select: sessionSelect,
	});
	if (!row) throw new AppError("not_found", "会话不存在。", 404);
	return sessionDto(row);
}
export async function listRequests(
	user: Viewer,
	side: Side,
	query: z.infer<typeof requestQuery>,
) {
	const rows = await db.meterRequest.findMany({
		where: {
			session: { [side]: user.address },
			...(query.sessionId ? { sessionId: query.sessionId } : {}),
			...(query.idempotencyKey ? { idempotencyKey: query.idempotencyKey } : {}),
		},
		select: requestSelect,
		...pagination(query),
	});
	return page(rows.map(requestDto), query.limit);
}
export async function lookupRequest(
	key: { id: string; sessionId: string | null; owner: string },
	idempotencyKey: string,
) {
	let sessionId = key.sessionId;
	let allocationStatus: string | undefined;
	if (!sessionId) {
		const invocation = await db.routedInvocation.findUnique({
			where: {
				accessKeyId_idempotencyKey: { accessKeyId: key.id, idempotencyKey },
			},
			include: { session: { select: { status: true } } },
		});
		if (!invocation)
			throw new AppError("not_found", "此 Key 尚未受理该幂等请求。", 404);
		sessionId = invocation.sessionId;
		allocationStatus = invocation.session.status;
	}
	const row = await db.meterRequest.findFirst({
		where: {
			sessionId,
			idempotencyKey,
			session: { consumer: key.owner },
		},
		select: requestSelect,
	});
	if (
		!row &&
		!key.sessionId &&
		["REJECTED", "CLOSED"].includes(allocationStatus ?? "")
	)
		throw new AppError(
			"request_not_executed",
			"资金预留已取消或释放，平台未调用上游；本次幂等键不会重复执行。",
			409,
		);
	if (!row && !key.sessionId)
		throw new AppError(
			"request_preparing",
			"请求已受理，尚无已执行的上游账单；请核对资金预留状态。",
			409,
		);
	if (!row)
		throw new AppError("not_found", "该密钥会话中尚无此请求记录。", 404);
	return requestDto(row);
}
export async function listKeys(
	user: Viewer,
	query: z.infer<typeof ledgerQuery>,
) {
	const rows = await db.accessKey.findMany({
		where: {
			owner: user.address,
			...(query.sessionId ? { sessionId: query.sessionId } : {}),
		},
		select: keySelect,
		...pagination(query),
	});
	return page(
		rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
		query.limit,
	);
}
export async function listSettlements(
	user: Viewer,
	side: Side,
	query: z.infer<typeof ledgerQuery>,
) {
	const rows = await db.settlement.findMany({
		where: {
			session: { [side]: user.address },
			...(query.sessionId ? { sessionId: query.sessionId } : {}),
		},
		select: settlementSelect,
		...pagination(query),
	});
	return page(
		rows.map((row) => ({
			...row,
			amount: ledgerAmount(row.amount),
			cumulative: ledgerAmount(row.cumulative),
			createdAt: row.createdAt.toISOString(),
		})),
		query.limit,
	);
}
export async function networkInfo() {
	let config: ReturnType<typeof chainConfig>;
	try {
		config = chainConfig();
	} catch {
		throw new AppError("chain_unavailable", "链上服务未配置。", 503);
	}
	let ready = false;
	try {
		ready = (await clients().publicClient.getChainId()) === config.chainId;
	} catch {
		/* unavailable, not ready */
	}
	return {
		asset: assetOf(config),
		ledgerUnit: billingUnit(assetOf(config)),
		balanceUnit: balanceUnit(assetOf(config)),
		tokenDecimals: decimalsOf(config),
		mode: config.mode,
		chainId: config.chainId,
		token: config.token,
		escrow: config.escrow,
		feeBps: 500,
		ready,
		rpcUrl: networkMetadata(config).rpcUrl,
		explorer: networkMetadata(config).explorer,
	};
}
export async function accountBalances(user: Viewer) {
	try {
		return {
			...(await chainBalances(user.address)),
			unit: balanceUnit(assetOf(chainConfig())),
		};
	} catch {
		throw new AppError("chain_unavailable", "暂时无法读取链上余额。", 503);
	}
}
