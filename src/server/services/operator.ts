import "server-only";
import type { Prisma } from "@prisma/client";
import { getAddress } from "viem";
import type { z } from "zod";
import { escrowAbi } from "~/lib/abi";
import { db } from "~/server/db";
import type {
	endpointPolicyInput,
	endpointStatusInput,
} from "~/shared/gateway-config";
import type { Viewer } from "~/shared/token2api";
import { AppError } from "./auth";
import { clients } from "./chain";
import type { operatorResourcesInput } from "./operator.schema";

export async function operatorStatus(user: Viewer | null) {
	const { config, publicClient } = clients();
	const owner = await publicClient.readContract({
		address: getAddress(config.escrow),
		abi: escrowAbi,
		functionName: "owner",
	});
	return {
		owner,
		authorized:
			!!user &&
			!user.demo &&
			user.address.toLowerCase() === owner.toLowerCase(),
	};
}
async function requireOperator(user: Viewer) {
	if (!(await operatorStatus(user)).authorized)
		throw new AppError(
			"forbidden",
			"只有当前托管合约的管理员钱包可以操作后台。",
			403,
		);
}

export async function listEndpointPolicies(user: Viewer) {
	await requireOperator(user);
	const [entries, gateways, proxies] = await Promise.all([
		db.endpointPolicy.findMany({
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		}),
		db.listing.groupBy({
			by: ["baseUrl"],
			where: { kind: "gateway", transport: "direct" },
			_count: { _all: true },
		}),
		db.listing.groupBy({
			by: ["proxyUrl"],
			where: { kind: "gateway", transport: "direct", proxyUrl: { not: null } },
			_count: { _all: true },
		}),
	]);
	return entries.map((entry) => ({
		...entry,
		resourceCount:
			entry.kind === "GATEWAY"
				? (gateways.find((row) => row.baseUrl === entry.url)?._count._all ?? 0)
				: (proxies.find((row) => row.proxyUrl === entry.url)?._count._all ?? 0),
		createdAt: entry.createdAt.toISOString(),
		updatedAt: entry.updatedAt.toISOString(),
	}));
}

export async function saveEndpointPolicy(
	user: Viewer,
	input: z.infer<typeof endpointPolicyInput>,
) {
	await requireOperator(user);
	const entry = await db.endpointPolicy.upsert({
		where: { kind_url: { kind: input.kind, url: input.url } },
		create: { ...input, updatedBy: user.address },
		update: { name: input.name, note: input.note, updatedBy: user.address },
		select: { id: true },
	});
	return entry;
}

export async function setEndpointStatus(
	user: Viewer,
	input: z.infer<typeof endpointStatusInput>,
) {
	await requireOperator(user);
	await db.$transaction(async (tx) => {
		const entry = await tx.endpointPolicy.findUnique({
			where: { id: input.id },
		});
		if (!entry) throw new AppError("not_found", "白名单记录不存在。", 404);
		await tx.endpointPolicy.update({
			where: { id: input.id },
			data: { enabled: input.enabled, updatedBy: user.address },
		});
		if (!input.enabled)
			await tx.listing.updateMany({
				where: {
					kind: "gateway",
					transport: "direct",
					...(entry.kind === "GATEWAY"
						? { baseUrl: entry.url }
						: { proxyUrl: entry.url }),
				},
				data: { enabled: false, status: "BLOCKED" },
			});
	});
	return { ok: true as const };
}

export async function operatorResources(
	user: Viewer,
	input: z.infer<typeof operatorResourcesInput>,
) {
	await requireOperator(user);
	let filter: Prisma.ListingWhereInput = {};
	if (input.endpointId) {
		const entry = await db.endpointPolicy.findUnique({
			where: { id: input.endpointId },
		});
		if (!entry) throw new AppError("not_found", "白名单记录不存在。", 404);
		filter = {
			transport: "direct",
			...(entry.kind === "GATEWAY"
				? { baseUrl: entry.url }
				: { proxyUrl: entry.url }),
		};
	}
	const rows = await db.listing.findMany({
		where: filter,
		orderBy: { id: "asc" },
		take: input.limit + 1,
		...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
		select: {
			id: true,
			name: true,
			owner: true,
			model: true,
			transport: true,
			baseUrl: true,
			proxyUrl: true,
			enabled: true,
			status: true,
			_count: { select: { sessions: true } },
		},
	});
	const data = rows.slice(0, input.limit);
	return {
		data,
		hasMore: rows.length > input.limit,
		nextCursor: rows.length > input.limit ? (data.at(-1)?.id ?? null) : null,
	};
}
