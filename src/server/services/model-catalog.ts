import "server-only";
import type { z } from "zod";
import { db } from "~/server/db";
import type {
	modelProductInput,
	modelRouteInput,
} from "~/shared/model-routing";
import type { Viewer } from "~/shared/token2api";
import { AppError } from "./auth";
import { resourceAvailable } from "./connector-availability";
import { requireGatewayAccess } from "./gateway-access";
import { requireOperator } from "./operator";

export async function modelCatalog() {
	const models = await db.modelProduct.findMany({
		where: { enabled: true },
		orderBy: { id: "asc" },
		include: {
			routes: { where: { enabled: true }, include: { listing: true } },
		},
	});
	return models.map((model) => ({
		id: model.id,
		name: model.name,
		inputRate: model.inputRate,
		outputRate: model.outputRate,
		available: model.routes.some(
			({ listing }) =>
				resourceAvailable(listing) &&
				listing.inputRate <= model.inputRate &&
				listing.outputRate <= model.outputRate,
		),
	}));
}

export async function requireModels(models: string[]) {
	const count = await db.modelProduct.count({
		where: { id: { in: models }, enabled: true },
	});
	if (count !== models.length)
		throw new AppError("model_not_available", "所选模型不存在或已停用。", 400);
}

export async function operatorModels(user: Viewer) {
	await requireOperator(user);
	const models = await db.modelProduct.findMany({
		orderBy: { id: "asc" },
		include: {
			routes: {
				orderBy: [{ priority: "asc" }, { id: "asc" }],
				include: {
					listing: {
						select: {
							id: true,
							name: true,
							model: true,
							owner: true,
							inputRate: true,
							outputRate: true,
							enabled: true,
							status: true,
							transport: true,
						},
					},
				},
			},
		},
	});
	return models.map(({ createdAt, updatedAt, routes, ...model }) => ({
		...model,
		createdAt: createdAt.toISOString(),
		updatedAt: updatedAt.toISOString(),
		routes: routes.map(({ createdAt: routeCreatedAt, ...route }) => ({
			...route,
			createdAt: routeCreatedAt.toISOString(),
		})),
	}));
}

export async function saveModel(
	user: Viewer,
	input: z.infer<typeof modelProductInput>,
) {
	await requireOperator(user);
	return db.modelProduct.upsert({
		where: { id: input.id },
		create: { ...input, updatedBy: user.address },
		update: { ...input, updatedBy: user.address },
		select: { id: true },
	});
}

export async function saveModelRoute(
	user: Viewer,
	input: z.infer<typeof modelRouteInput>,
) {
	await requireOperator(user);
	const [model, listing] = await Promise.all([
		db.modelProduct.findUnique({ where: { id: input.modelId } }),
		db.listing.findUnique({ where: { id: input.listingId } }),
	]);
	if (!model || !listing || listing.kind !== "gateway")
		throw new AppError("not_found", "模型或真实资源不存在。", 404);
	if (input.enabled) {
		if (
			listing.inputRate > model.inputRate ||
			listing.outputRate > model.outputRate
		)
			throw new AppError(
				"price_below_cost",
				"平台报价不能低于所选上游报价。",
				400,
			);
		if (listing.transport === "direct")
			await requireGatewayAccess(listing.baseUrl ?? "", listing.proxyUrl);
	}
	return db.modelRoute.upsert({
		where: {
			modelId_listingId: { modelId: input.modelId, listingId: input.listingId },
		},
		create: input,
		update: { priority: input.priority, enabled: input.enabled },
		select: { id: true },
	});
}
