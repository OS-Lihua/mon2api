import { z } from "zod";
import { modelCatalog } from "./model-catalog";

export const CONNECTOR_HEARTBEAT_MS = 15_000;
export const CONNECTOR_JOB_MS = 40_000;
export const connectorTokenSchema = z.string().regex(/^m2c_[\w-]{43}$/);
export const connectorLaunchCode = z.string().regex(/^m2l_[\w-]{43}$/);
export const connectorLaunchResponse = z
	.object({ code: connectorLaunchCode, expiresAt: z.string().datetime() })
	.strict();
export const connectorTokenResponse = z
	.object({ token: connectorTokenSchema })
	.strict();
export const connectorPayload = z
	.object({
		model: z.string().min(1).max(100),
		messages: z
			.array(
				z
					.object({
						role: z.enum(["system", "user", "assistant"]),
						content: z.string().max(24000),
					})
					.strict(),
			)
			.min(1)
			.max(20),
		maxTokens: z.number().int().min(128).max(2048),
		conversationId: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict();
export const connectorResult = z
	.object({
		text: z.string().max(65536),
		finishReason: z.enum(["stop", "length", "content_filter"]),
		inputTokens: z.number().int().nonnegative().max(2147483647).nullable(),
		outputTokens: z.number().int().nonnegative().max(2147483647).nullable(),
		usageSource: z.enum(["upstream_reported", "missing"]),
		pendingReview: z.boolean(),
		upstreamRequestId: z.string().max(256).nullable(),
	})
	.strict();
export const connectorFailure = z
	.object({
		code: z.enum([
			"configuration",
			"aborted",
			"rate_limited",
			"authorization",
			"upstream_unavailable",
			"invalid_response",
			"incomplete_stream",
		]),
		upstreamRequestId: z.string().max(256).nullable(),
	})
	.strict();
export const connectorPollInput = z
	.object({ model: z.string().min(1).max(100).optional() })
	.strict();
export const connectorJob = z
	.object({
		id: z.string().cuid(),
		input: connectorPayload,
		expiresAt: z.string().datetime(),
	})
	.strict();
export const connectorPollResponse = z
	.object({
		listingId: z.string().cuid(),
		enabled: z.boolean(),
		job: connectorJob.nullable(),
	})
	.strict();
const updateFields = {
	jobId: z.string().cuid(),
	revision: z.number().int().min(1).max(1000),
	text: z.string().max(65536),
};
export const connectorUpdate = z.discriminatedUnion("event", [
	z.object({ ...updateFields, event: z.literal("progress") }).strict(),
	z
		.object({
			...updateFields,
			event: z.literal("complete"),
			result: connectorResult,
		})
		.strict(),
	z
		.object({
			...updateFields,
			event: z.literal("failed"),
			failure: connectorFailure,
		})
		.strict(),
]);
export const connectorStatusResponse = z
	.object({
		listingId: z.string().cuid(),
		model: z.string(),
		enabled: z.boolean(),
		online: z.boolean(),
	})
	.strict();
export const connectorOk = z.object({ ok: z.literal(true) }).strict();
export const connectorCatalogInput = z
	.object({ models: modelCatalog })
	.strict();
