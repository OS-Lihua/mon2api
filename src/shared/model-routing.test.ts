import { expect, it } from "vitest";
import {
	modelKeyInput,
	modelProductInput,
	modelRouteInput,
	prepaidTransferInput,
} from "./model-routing";

it.each([
	[],
	["model", "model"],
	Array.from({ length: 101 }, (_, index) => `model-${index}`),
	["invalid model"],
])("rejects an invalid model allowlist", (models) => {
	expect(modelKeyInput.safeParse({ name: "Application", models }).success).toBe(
		false,
	);
});
it("requires explicit models and rejects supplier or owner fields on a model key", () => {
	expect(
		modelKeyInput.parse({
			name: "App",
			models: ["public/model:v1", "another-model"],
		}).models,
	).toHaveLength(2);
	expect(modelKeyInput.safeParse({ name: "App" }).success).toBe(false);
	expect(
		modelKeyInput.safeParse({
			name: "App",
			models: ["model"],
			owner: "someone",
		}).success,
	).toBe(false);
});
it("keeps transfer amounts in positive exact micro-units", () => {
	for (const amount of [0, -1, 0.1, Number.MAX_SAFE_INTEGER + 1, Infinity])
		expect(
			prepaidTransferInput.safeParse({ kind: "deposit", amount }).success,
		).toBe(false);
	expect(
		prepaidTransferInput.parse({ kind: "withdraw", amount: 1 }).amount,
	).toBe(1);
});
it("validates model prices, route priority and strict runtime fields", () => {
	expect(
		modelProductInput.safeParse({
			id: "model",
			name: "Model",
			inputRate: 0,
			outputRate: 1,
			enabled: true,
		}).success,
	).toBe(false);
	expect(
		modelRouteInput.safeParse({
			modelId: "model",
			listingId: "cmroute0000000000000000000",
			priority: -1,
			enabled: true,
		}).success,
	).toBe(false);
});
