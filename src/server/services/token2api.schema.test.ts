import { describe, expect, it } from "vitest";
import {
	chatInput,
	listingInput,
	listingUpdateInput,
	messagesSchema,
	publicChatInput,
} from "./token2api.schema";

const messages = [{ role: "user", content: "hello" }];

describe("resource connection modes", () => {
	const gateway = {
		name: "My resource",
		description: "A provider resource",
		kind: "gateway",
		model: "example-model",
		inputRate: 1,
		outputRate: 2,
		baseUrl: "https://pool.example/v1",
		apiKey: "dedicated-inference-key",
	};
	it("preserves API compatibility and accepts an explicit OAuth pool mode", () => {
		expect(listingInput.parse(gateway).connectionMode).toBe("api");
		expect(
			listingInput.parse({ ...gateway, connectionMode: "oauth_pool" }),
		).toMatchObject({
			connectionMode: "oauth_pool",
			kind: "gateway",
		});
	});
	it.each([
		{ ...gateway, connectionMode: "oauth" },
		{ ...gateway, connectionMode: "oauth_pool", kind: "demo" },
		{ ...gateway, connectionMode: "oauth_pool", apiKey: undefined },
		{ ...gateway, connectionMode: "oauth_pool", baseUrl: undefined },
		{
			...gateway,
			connectionMode: "oauth_pool",
			refreshToken: "not-a-gateway-key",
		},
	])("rejects invalid modes and incomplete pool connections", (input) => {
		expect(listingInput.safeParse(input).success).toBe(false);
	});
	it("prevents changes to a resource's connection mode after publication", () => {
		expect(
			listingUpdateInput.safeParse({ connectionMode: "oauth_pool" }).success,
		).toBe(false);
	});
});

describe("Token2API Unicode input limits", () => {
	it("applies code-point limits to internal conversation and idempotency fields", () => {
		const input = {
			sessionId: `0x${"a".repeat(64)}`,
			messages,
			conversationId: "😀".repeat(120),
			idempotencyKey: "😀".repeat(128),
		};
		expect(chatInput.safeParse(input).success).toBe(true);
		expect(
			chatInput.safeParse({ ...input, conversationId: "😀".repeat(121) })
				.success,
		).toBe(false);
		expect(
			chatInput.safeParse({ ...input, idempotencyKey: "😀".repeat(129) })
				.success,
		).toBe(false);
		expect(
			chatInput.safeParse({ ...input, idempotencyKey: "😀".repeat(7) }).success,
		).toBe(false);
		expect(
			chatInput.safeParse({ ...input, idempotencyKey: "😀".repeat(8) }).success,
		).toBe(true);
	});

	it("applies code-point limits after trimming listing text", () => {
		const input = {
			name: ` ${"😀".repeat(64)} `,
			description: ` ${"𠮷".repeat(300)} `,
			model: "test-model",
			kind: "gateway",
			inputRate: 1,
			outputRate: 1,
			baseUrl: "https://gateway.example/v1",
			apiKey: "😀".repeat(2048),
		};
		expect(listingInput.parse(input)).toMatchObject({
			name: input.name.trim(),
			description: input.description.trim(),
		});
		expect(listingInput.safeParse({ ...input, name: "😀" }).success).toBe(
			false,
		);
		expect(
			listingInput.safeParse({ ...input, name: "😀".repeat(65) }).success,
		).toBe(false);
		expect(
			listingInput.safeParse({ ...input, description: "😀".repeat(301) })
				.success,
		).toBe(false);
		expect(
			listingInput.safeParse({ ...input, apiKey: "😀".repeat(2049) }).success,
		).toBe(false);
	});

	it("counts code points rather than graphemes or UTF-16 code units", () => {
		expect(
			publicChatInput.safeParse({ model: "😀".repeat(100), messages }).success,
		).toBe(true);
		expect(
			publicChatInput.safeParse({ model: "😀".repeat(101), messages }).success,
		).toBe(false);
		expect(
			publicChatInput.safeParse({ model: "é".repeat(50), messages }).success,
		).toBe(true);
		expect(
			publicChatInput.safeParse({ model: "é".repeat(51), messages }).success,
		).toBe(false);
	});

	it("keeps the serialized UTF-8 byte cap inclusive of JSON syntax and escaping", () => {
		const overhead = Buffer.byteLength(
			JSON.stringify([{ role: "user", content: "" }]),
			"utf8",
		);
		const content = `${"汉".repeat(7990)}${"x".repeat(24000 - overhead - 7990 * 3)}`;
		const boundary = [{ role: "user", content }];
		expect(Buffer.byteLength(JSON.stringify(boundary), "utf8")).toBe(24000);
		expect(messagesSchema.safeParse(boundary).success).toBe(true);
		expect(
			messagesSchema.safeParse([{ role: "user", content: `${content}x` }])
				.success,
		).toBe(false);
		expect(
			messagesSchema.safeParse([
				{ role: "user", content: "\u0000".repeat(4000) },
			]).success,
		).toBe(false);
	});
});
