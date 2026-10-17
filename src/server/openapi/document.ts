import "server-only";

import {
	OpenAPIRegistry,
	OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
	apiErrorResponseSchema,
	completionResponseSchema,
	modelListResponseSchema,
	streamChunkResponseSchema,
	usageResponseSchema,
} from "~/server/services/mon2api.contract";
import { publicChatInput } from "~/server/services/mon2api.schema";

import { registerCommerce } from "./commerce";

const registry = new OpenAPIRegistry();
registry.registerComponent("securitySchemes", "bearerAuth", {
	type: "http",
	scheme: "bearer",
	bearerFormat: "mon2api API Key",
});
const chatInput = registry.register("ChatInput", publicChatInput);
registry.register("Usage", usageResponseSchema);
const completion = registry.register("Completion", completionResponseSchema);
const models = registry.register("ModelList", modelListResponseSchema);
const apiError = registry.register("Error", apiErrorResponseSchema);
registry.register("StreamChunk", streamChunkResponseSchema);

function errorResponse(description: string) {
	return {
		description,
		content: { "application/json": { schema: apiError } },
	};
}

registry.registerPath({
	method: "get",
	path: "/models",
	operationId: "listModels",
	summary: "List the model bound to this API key",
	responses: {
		200: {
			description: "OpenAI-compatible model list",
			content: { "application/json": { schema: models } },
		},
		401: errorResponse("Missing or invalid API key"),
		429: errorResponse("Too many requests"),
		500: errorResponse("Unexpected server error"),
	},
});

registry.registerPath({
	method: "post",
	path: "/chat/completions",
	operationId: "createChatCompletion",
	summary: "Generate a metered text completion",
	description:
		"Text only. JSON.stringify(messages) must encode to at most 24000 UTF-8 bytes, including JSON syntax and escaping. Raw request bodies are limited to 160 KiB (163840 bytes), counted from the stream regardless of Content-Length, with a 10 second total read deadline before JSON parsing. API key binds one lease/model. Idempotency-Key is required for every chat request; reuse the same key on retries. Duplicate keys return 409 without another upstream call. A stream can emit an Error frame after HTTP 200. Unknown usage retains its reservation in REVIEW. No automatic retry.",
	request: {
		headers: z.object({
			"Idempotency-Key": z.string().min(8).max(128),
		}),
		body: {
			required: true,
			content: { "application/json": { schema: chatInput } },
		},
	},
	responses: {
		200: {
			description:
				"Completion or SSE data frames containing StreamChunk or Error, followed by [DONE]. include_usage adds a StreamChunk with empty choices and usage. Only terminal choices have a non-null finish_reason.",
			headers: {
				"x-idempotency-key": { schema: { type: "string" } },
			},
			content: {
				"application/json": { schema: completion },
				"text/event-stream": { schema: z.string() },
			},
		},
		400: errorResponse(
			"Invalid JSON, invalid request fields, or body stream read failure",
		),
		401: errorResponse("Missing or invalid API key"),
		402: errorResponse("Insufficient lease budget"),
		408: errorResponse(
			"Request body read exceeded the 10 second total deadline",
		),
		409: errorResponse("Duplicate request or usage pending review"),
		413: errorResponse("Raw request body exceeds 160 KiB (163840 bytes)"),
		429: errorResponse("Too many requests"),
		500: errorResponse("Unexpected server error"),
		502: errorResponse("Invalid or failed upstream response"),
		503: errorResponse("Upstream unavailable"),
	},
});

registerCommerce(registry, apiError);

export const openApiDocument = new OpenApiGeneratorV31(
	registry.definitions,
).generateDocument({
	openapi: "3.1.0",
	info: {
		title: "mon2api API",
		version: "0.2.0",
		description:
			"Merchant and consumer management over wallet sessions; text inference over scoped API keys. Management endpoints use /api/v1 only. /v1 is an inference alias. Off-chain metering and prepaid on-chain settlement. Test dUSD uses 6 decimals.",
	},
	servers: [{ url: "/api/v1" }, { url: "/v1" }],
	security: [{ bearerAuth: [] }],
});
