import Ajv2020 from "ajv/dist/2020";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openApiDocument } from "~/server/openapi/document";
import {
	apiErrorResponseSchema,
	completionResponseSchema,
	MAX_RAW_BODY_BYTES,
	modelListResponseSchema,
	streamChunkResponseSchema,
} from "~/server/services/token2api.contract";
import { chatPost, modelsGet } from "./chat";

const mocks = vi.hoisted(() => ({
	authenticateKey: vi.fn(),
	findUnique: vi.fn(),
	findUniqueOrThrow: vi.fn(),
	runChat: vi.fn(),
	limitRequest: vi.fn(),
}));

vi.mock("~/server/services/auth", () => ({
	AppError: class extends Error {
		constructor(
			public code: string,
			message: string,
			public status = 400,
		) {
			super(message);
		}
	},
}));
vi.mock("~/server/db", () => ({
	db: {
		lease: {
			findUnique: mocks.findUnique,
			findUniqueOrThrow: mocks.findUniqueOrThrow,
		},
	},
}));
vi.mock("~/server/services/market", () => ({
	authenticateKey: mocks.authenticateKey,
}));
vi.mock("~/server/services/metering", () => ({ runChat: mocks.runChat }));
vi.mock("~/server/services/runtime", () => ({
	chainConfig: () => ({ asset: "USDC" }),
}));
vi.mock("~/env", () => ({ env: { ALLOWED_ORIGINS: "" } }));
vi.mock("~/server/security/rate-limit", () => ({
	limitRequest: mocks.limitRequest,
	limitCredential: async () => ({ success: true }),
}));
vi.mock("~/server/observability/logger", () => ({
	logger: { error: vi.fn() },
}));

const ajv = new Ajv2020();
ajv.addKeyword({ keyword: "components", valid: true });
function contract(name: string) {
	return ajv.compile({
		$ref: `#/components/schemas/${name}`,
		components: openApiDocument.components,
	});
}
const validateCompletion = contract("Completion");
const validateChunk = contract("StreamChunk");
const validateModels = contract("ModelList");
const validateError = contract("Error");

function request(body: string) {
	return new Request("https://example.com/api/v1/chat/completions", {
		method: "POST",
		headers: {
			authorization: "Bearer test-key",
			"idempotency-key": "test-request-123",
		},
		body,
	});
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.limitRequest.mockResolvedValue({ success: true });
	mocks.authenticateKey.mockResolvedValue({
		id: "key-test",
		owner: "consumer",
		sessionId: "session-test",
	});
	const lease = {
		model: "test-model",
		provider: "provider",
		createdAt: new Date("2026-01-01T00:00:00Z"),
	};
	mocks.findUnique.mockResolvedValue(lease);
	mocks.findUniqueOrThrow.mockResolvedValue(lease);
});

describe("live REST response contracts", () => {
	it.each(["stop", "length", "content_filter"] as const)(
		"validates JSON and SSE responses for %s against shared Zod and generated JSON Schema",
		async (finishReason) => {
			mocks.runChat.mockImplementation(
				async (_owner, _args, onDelta: (text: string) => void) => {
					onDelta("hello 😀");
					return {
						id: "request-test",
						text: "hello 😀",
						finishReason,
						inputTokens: 3,
						outputTokens: 2,
						cost: 1,
						usageSource: "upstream_reported",
					};
				},
			);
			const input = {
				model: "test-model",
				messages: [{ role: "user", content: "hi" }],
			};
			const response = await chatPost(request(JSON.stringify(input)));
			expect(response.status).toBe(200);
			const completion: unknown = await response.json();
			expect(completionResponseSchema.safeParse(completion).success).toBe(true);
			expect(
				validateCompletion(completion),
				JSON.stringify(validateCompletion.errors),
			).toBe(true);

			const stream = await chatPost(
				request(
					JSON.stringify({
						...input,
						stream: true,
						stream_options: { include_usage: true },
					}),
				),
			);
			expect(stream.status).toBe(200);
			const frames = (await stream.text())
				.trim()
				.split("\n\n")
				.map((frame) => frame.slice("data: ".length));
			expect(frames.pop()).toBe("[DONE]");
			expect(frames).toHaveLength(3);
			for (const frame of frames) {
				const chunk: unknown = JSON.parse(frame);
				expect(streamChunkResponseSchema.safeParse(chunk).success).toBe(true);
				expect(validateChunk(chunk), JSON.stringify(validateChunk.errors)).toBe(
					true,
				);
			}
		},
	);

	it("validates the actual model list response", async () => {
		const response = await modelsGet(
			new Request("https://example.com/api/v1/models", {
				headers: { authorization: "Bearer test-key" },
			}),
		);
		const body: unknown = await response.json();
		expect(response.status).toBe(200);
		expect(modelListResponseSchema.safeParse(body).success).toBe(true);
		expect(validateModels(body)).toBe(true);
	});

	it.each([
		{ body: "{", status: 400 },
		{
			body: JSON.stringify({
				model: "test-model",
				messages: [{ role: "user", content: "汉".repeat(8000) }],
			}),
			status: 400,
		},
		{
			body: JSON.stringify({
				model: "test-model",
				messages: [{ role: "user", content: "x".repeat(MAX_RAW_BODY_BYTES) }],
			}),
			status: 413,
		},
	])(
		"returns documented $status before authentication, DB or metering work",
		async ({ body, status }) => {
			const response = await chatPost(request(body));
			const error: unknown = await response.json();
			expect(response.status).toBe(status);
			expect(apiErrorResponseSchema.safeParse(error).success).toBe(true);
			expect(validateError(error)).toBe(true);
			expect(mocks.authenticateKey).not.toHaveBeenCalled();
			expect(mocks.findUnique).not.toHaveBeenCalled();
			expect(mocks.runChat).not.toHaveBeenCalled();
		},
	);
});
