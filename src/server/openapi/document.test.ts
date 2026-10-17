import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import {
	apiErrorResponseSchema,
	completionResponseSchema,
	modelListResponseSchema,
	streamChunkResponseSchema,
} from "~/server/services/mon2api.contract";
import { publicChatInput } from "~/server/services/mon2api.schema";
import { openApiDocument } from "./document";

// OpenAPI stores reusable schemas in components instead of $defs. Ajv resolves
// these JSON Pointers; allow the OpenAPI container keyword, but keep strict checks
// on every referenced JSON Schema. Do not apply defaults or remove extra fields.
const ajv = new Ajv2020({ allErrors: true });
ajv.addKeyword({ keyword: "components", valid: true });
function contract(name: string) {
	return ajv.compile({
		$ref: `#/components/schemas/${name}`,
		components: openApiDocument.components,
	});
}
const validateInput = contract("ChatInput");
const validInput = {
	model: "test",
	messages: [{ role: "user", content: "hello" }],
};

function expectInputAgreement(input: unknown, valid: boolean) {
	expect(publicChatInput.safeParse(input).success).toBe(valid);
	expect(validateInput(input), JSON.stringify(validateInput.errors)).toBe(
		valid,
	);
}

describe("mon2api OpenAPI", () => {
	it("documents authenticated versioned model and chat endpoints", () => {
		expect(openApiDocument.openapi).toBe("3.1.0");
		const paths = openApiDocument.paths;
		if (!paths) throw new Error("Missing OpenAPI paths");
		expect(Object.keys(paths)).toEqual(["/models", "/chat/completions"]);
		expect(openApiDocument.servers).toEqual([
			{ url: "/api/v1" },
			{ url: "/v1" },
		]);
		expect(paths["/models"]?.get?.operationId).toBe("listModels");
		expect(paths["/chat/completions"]?.post?.operationId).toBe(
			"createChatCompletion",
		);
		expect(openApiDocument.security).toEqual([{ bearerAuth: [] }]);
	});

	it("documents stream, transport limits, and all structured error statuses", () => {
		const post = openApiDocument.paths?.["/chat/completions"]?.post;
		for (const status of [400, 401, 402, 408, 409, 413, 429, 500, 502, 503]) {
			expect(post?.responses?.[status]).toMatchObject({
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/Error" },
					},
				},
			});
		}
		expect(post?.responses?.[200]).toMatchObject({
			content: {
				"application/json": {
					schema: { $ref: "#/components/schemas/Completion" },
				},
				"text/event-stream": { schema: { type: "string" } },
			},
		});
		expect(post?.description).toContain("163840 bytes");
		expect(post?.description).toContain("10 second total read deadline");
	});

	it("generates request fields, defaults and strictness from publicChatInput", () => {
		expect(openApiDocument.components?.schemas?.ChatInput).toMatchObject({
			type: "object",
			required: ["model", "messages"],
			additionalProperties: false,
			properties: {
				model: { minLength: 1, maxLength: 100 },
				conversation_id: { minLength: 1, maxLength: 120, default: "default" },
				max_tokens: {
					type: "integer",
					minimum: 128,
					maximum: 2048,
					default: 512,
				},
				stream: { type: "boolean", default: false },
				messages: { minItems: 1, maxItems: 20 },
			},
		});
		expectInputAgreement(validInput, true);
		expect(publicChatInput.parse(validInput)).toMatchObject({
			max_tokens: 512,
			stream: false,
			conversation_id: "default",
		});
		expect(validInput).not.toHaveProperty("max_tokens");
	});

	it.each([
		null,
		[],
		"text",
		1,
		{},
		{ model: "test" },
		{ ...validInput, model: "" },
		{ ...validInput, model: "😀".repeat(101) },
		{ ...validInput, conversation_id: "" },
		{ ...validInput, conversation_id: "😀".repeat(121) },
		{ ...validInput, max_tokens: 127 },
		{ ...validInput, max_tokens: 2049 },
		{ ...validInput, max_tokens: 128.5 },
		{ ...validInput, max_tokens: "512" },
		{ ...validInput, max_tokens: null },
		{ ...validInput, stream: "true" },
		{ ...validInput, stream_options: { include_usage: "yes" } },
		{ ...validInput, stream_options: { unexpected: true } },
		{ ...validInput, n: 2 },
		{ ...validInput, tools: [] },
		{ ...validInput, messages: [] },
		{
			...validInput,
			messages: Array.from({ length: 21 }, () => ({
				role: "user",
				content: "",
			})),
		},
		{ ...validInput, messages: [{ role: "tool", content: "hi" }] },
		{
			...validInput,
			messages: [{ role: "user", content: "hi", name: "extra" }],
		},
		{ ...validInput, messages: [{ role: "user", content: "x".repeat(8001) }] },
	])("rejects the same invalid request in Zod and Ajv: %j", (input) => {
		expectInputAgreement(input, false);
	});

	it.each([128, 2048])("accepts max_tokens boundary %s", (max_tokens) => {
		expectInputAgreement(
			{
				...validInput,
				max_tokens,
				stream: true,
				stream_options: { include_usage: true },
			},
			true,
		);
	});

	it("counts supplementary Unicode as one code point for model, conversation and content", () => {
		expectInputAgreement(
			{
				model: "😀".repeat(100),
				conversation_id: "𠮷".repeat(120),
				messages: [
					{ role: "user", content: `${"😀".repeat(1000)}${"x".repeat(7000)}` },
				],
			},
			true,
		);
		expectInputAgreement(
			{
				...validInput,
				messages: [{ role: "user", content: "x".repeat(8000) }],
			},
			true,
		);
		expectInputAgreement(
			{ ...validInput, messages: [{ role: "user", content: "" }] },
			true,
		);
		expectInputAgreement(
			{
				...validInput,
				messages: Array.from({ length: 20 }, () => ({
					role: "assistant",
					content: "",
				})),
			},
			true,
		);
	});

	it("describes and explicitly tests the runtime-only 24000-byte refinement", () => {
		expect(openApiDocument.components?.schemas?.ChatInput).toMatchObject({
			properties: {
				messages: {
					description: expect.stringContaining(
						"cannot be expressed by standard JSON Schema",
					),
				},
			},
		});
		const messages = [
			{ role: "user", content: "x".repeat(8000) },
			{ role: "user", content: "x".repeat(8000) },
			{ role: "user", content: "x".repeat(7912) },
		];
		expect(Buffer.byteLength(JSON.stringify(messages), "utf8")).toBe(24000);
		expectInputAgreement({ ...validInput, messages }, true);
		messages[2] = { role: "user", content: "x".repeat(7913) };
		const oversized = { ...validInput, messages };
		expect(Buffer.byteLength(JSON.stringify(messages), "utf8")).toBe(24001);
		expect(validateInput(oversized)).toBe(true);
		expect(publicChatInput.safeParse(oversized).success).toBe(false);

		for (const content of [
			"汉".repeat(8000),
			"😀".repeat(6000),
			"\u0000".repeat(4000),
		]) {
			const input = { ...validInput, messages: [{ role: "user", content }] };
			expect(validateInput(input)).toBe(true);
			expect(publicChatInput.safeParse(input).success).toBe(false);
		}
	});

	it("uses the shared response schemas for models, errors and all finish reasons", () => {
		const validateCompletion = contract("Completion");
		const completion = {
			id: "chatcmpl-test",
			object: "chat.completion",
			created: 123,
			model: "test",
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: "hello" },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
			mon2api: {
				request_id: "request-test",
				cost: 1,
				unit: "micro_dUSD",
				usage_source: "demo",
			},
		};
		for (const finish_reason of ["stop", "length", "content_filter"]) {
			const input = {
				...completion,
				choices: [{ ...completion.choices[0], finish_reason }],
			};
			expect(completionResponseSchema.safeParse(input).success).toBe(true);
			expect(validateCompletion(input)).toBe(true);
		}
		for (const finish_reason of [
			"tool_calls",
			"function_call",
			"unknown",
			null,
		]) {
			const input = {
				...completion,
				choices: [{ ...completion.choices[0], finish_reason }],
			};
			expect(completionResponseSchema.safeParse(input).success).toBe(false);
			expect(validateCompletion(input)).toBe(false);
		}
		for (const usage of [
			{ prompt_tokens: -1, completion_tokens: 0, total_tokens: 0 },
			{ prompt_tokens: 0.5, completion_tokens: 0, total_tokens: 0 },
			{},
		]) {
			expect(
				completionResponseSchema.safeParse({ ...completion, usage }).success,
			).toBe(false);
			expect(validateCompletion({ ...completion, usage })).toBe(false);
		}
		const models = {
			object: "list",
			data: [
				{ id: "test", object: "model", created: 123, owned_by: "provider" },
			],
		};
		expect(modelListResponseSchema.safeParse(models).success).toBe(true);
		expect(contract("ModelList")(models)).toBe(true);
		for (const input of [
			{ error: { code: "invalid_request", message: "Invalid body" } },
			{
				error: {
					code: "invalid_request",
					message: "Invalid body",
					details: { fields: [] },
				},
			},
		]) {
			expect(apiErrorResponseSchema.safeParse(input).success).toBe(true);
			expect(contract("Error")(input)).toBe(true);
		}
		expect(contract("Error")({ error: { code: "invalid_request" } })).toBe(
			false,
		);
		expect(
			apiErrorResponseSchema.safeParse({ error: { code: "invalid_request" } })
				.success,
		).toBe(false);
	});

	it("validates SSE delta, terminal and usage chunks with the shared response schema", () => {
		const validate = contract("StreamChunk");
		const base = {
			id: "chatcmpl-test",
			object: "chat.completion.chunk",
			created: 123,
			model: "test",
		};
		for (const input of [
			{
				...base,
				choices: [
					{ index: 0, delta: { content: "hello" }, finish_reason: null },
				],
			},
			...["stop", "length", "content_filter"].map((finish_reason) => ({
				...base,
				choices: [{ index: 0, delta: {}, finish_reason }],
			})),
			{
				...base,
				choices: [],
				usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
			},
		]) {
			expect(streamChunkResponseSchema.safeParse(input).success).toBe(true);
			expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
		}
		const invalid = {
			...base,
			choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
		};
		expect(streamChunkResponseSchema.safeParse(invalid).success).toBe(false);
		expect(validate(invalid)).toBe(false);
	});
});
