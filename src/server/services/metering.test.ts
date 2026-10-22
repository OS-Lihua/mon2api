import { describe, expect, it, vi } from "vitest";
import { calculateCost } from "./metering";
import {
	chatInput,
	listingInput,
	messagesSchema,
	openSessionInput,
	publicChatInput,
} from "./token2api.schema";

// Cost/schema tests must not create a Prisma connection or require PostgreSQL.
vi.mock("~/server/db", () => ({ db: {} }));

const sessionId = `0x${"12".repeat(32)}`;
const messages = [{ role: "user" as const, content: "hello" }];
const listing = {
	name: "Test resource",
	description: "A test connector",
	model: "test/model-1",
	kind: "demo" as const,
	inputRate: 1_000_000,
	outputRate: 2_000_000,
};
const chat = { sessionId, messages, idempotencyKey: "request-0001" };

describe("integer token pricing", () => {
	it("prices input and output together using integer micro-units", () => {
		expect(calculateCost(1_000_000, 1_000_000, 100_000, 200_000)).toBe(300_000);
		expect(calculateCost(0, 0, 1, 1)).toBe(0);
		expect(calculateCost(1, 0, 1, 1)).toBe(1);
		// Round the combined cost once, rather than rounding each token category.
		expect(calculateCost(1, 1, 1, 1)).toBe(1);
		expect(calculateCost(1, 1, 500_000, 500_001)).toBe(2);
	});

	it("avoids floating-point multiplication loss", () => {
		expect(calculateCost(1_000_000_001, 1, 1_000_000_000, 1)).toBe(
			1_000_000_001_001,
		);
	});

	it("rejects costs that cannot be represented safely", () => {
		expect(() =>
			calculateCost(Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER, 1),
		).toThrow();
	});

	it.each([
		-1,
		0.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.MAX_SAFE_INTEGER + 1,
	])("rejects invalid token counts or prices: %s", (value) => {
		expect(() => calculateCost(value, 1, 1, 1)).toThrow();
		expect(() => calculateCost(1, value, 1, 1)).toThrow();
		expect(() => calculateCost(1, 1, value, 1)).toThrow();
		expect(() => calculateCost(1, 1, 1, value)).toThrow();
	});
});

describe("market and chat validation", () => {
	it("accepts bounded integer listing prices and defaults concurrency", () => {
		expect(listingInput.parse(listing).concurrency).toBe(2);
		expect(
			listingInput.safeParse({
				...listing,
				inputRate: 1,
				outputRate: 1_000_000_000,
				concurrency: 20,
			}).success,
		).toBe(true);
	});

	it.each([
		0,
		-1,
		0.5,
		1_000_000_001,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		"100",
	])("rejects invalid integer prices: %s", (price) => {
		expect(
			listingInput.safeParse({ ...listing, inputRate: price }).success,
		).toBe(false);
		expect(
			listingInput.safeParse({ ...listing, outputRate: price }).success,
		).toBe(false);
	});

	it("requires credentials for a real connector and rejects injected listing fields", () => {
		expect(
			listingInput.safeParse({ ...listing, kind: "gateway" }).success,
		).toBe(false);
		expect(
			listingInput.safeParse({
				...listing,
				kind: "gateway",
				baseUrl: "https://connector.example/v1",
			}).success,
		).toBe(false);
		expect(
			listingInput.safeParse({
				...listing,
				kind: "gateway",
				baseUrl: "https://connector.example/v1",
				apiKey: "test-only",
			}).success,
		).toBe(true);
		expect(
			listingInput.safeParse({ ...listing, owner: "attacker" }).success,
		).toBe(false);
		expect(listingInput.safeParse({ ...listing, concurrency: 0 }).success).toBe(
			false,
		);
		expect(
			listingInput.safeParse({ ...listing, concurrency: 21 }).success,
		).toBe(false);
	});

	it("accepts user-selected positive budgets without business caps and rejects inexact amounts", () => {
		const input = {
			listingId: "cmabcdefg00000000000000000",
			budget: 1_000_000,
		};
		expect(openSessionInput.safeParse(input).success).toBe(true);
		expect(
			openSessionInput.safeParse({ ...input, budget: 100_000_000 }).success,
		).toBe(true);
		for (const budget of [
			1,
			999_999,
			100_000_001,
			5_000_000_000,
			Number.MAX_SAFE_INTEGER,
		]) {
			expect(openSessionInput.parse({ ...input, budget }).budget).toBe(budget);
		}
		for (const budget of [
			0,
			-1,
			Number.MAX_SAFE_INTEGER + 1,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			1_000_000.5,
			"1000000",
		]) {
			expect(openSessionInput.safeParse({ ...input, budget }).success).toBe(
				false,
			);
		}
		expect(
			openSessionInput.safeParse({ ...input, provider: "attacker" }).success,
		).toBe(false);
	});

	it("applies output defaults and enforces an explicit bounded idempotency key", () => {
		expect(chatInput.parse(chat)).toEqual({
			...chat,
			maxTokens: 512,
			conversationId: "default",
		});
		expect(
			chatInput.safeParse({
				...chat,
				idempotencyKey: "x".repeat(8),
				maxTokens: 128,
			}).success,
		).toBe(true);
		expect(
			chatInput.safeParse({
				...chat,
				idempotencyKey: "x".repeat(128),
				maxTokens: 2048,
			}).success,
		).toBe(true);
		for (const key of [
			undefined,
			"",
			"x".repeat(7),
			"x".repeat(129),
			12345678,
		]) {
			expect(
				chatInput.safeParse({ ...chat, idempotencyKey: key }).success,
			).toBe(false);
		}
		for (const maxTokens of [127, 2049, 128.5, "512"]) {
			expect(chatInput.safeParse({ ...chat, maxTokens }).success).toBe(false);
		}
		expect(chatInput.safeParse({ ...chat, sessionId: "invalid" }).success).toBe(
			false,
		);
		expect(chatInput.safeParse({ ...chat, conversationId: "" }).success).toBe(
			false,
		);
		expect(
			chatInput.safeParse({ ...chat, conversationId: "x".repeat(121) }).success,
		).toBe(false);
	});

	it("accepts only bounded text messages and counts UTF-8 bytes", () => {
		expect(messagesSchema.safeParse(messages).success).toBe(true);
		expect(messagesSchema.safeParse([]).success).toBe(false);
		expect(
			messagesSchema.safeParse(Array.from({ length: 21 }, () => messages[0]))
				.success,
		).toBe(false);
		expect(
			messagesSchema.safeParse([{ role: "tool", content: "no" }]).success,
		).toBe(false);
		expect(
			messagesSchema.safeParse([
				{ role: "user", content: [{ type: "text", text: "no" }] },
			]).success,
		).toBe(false);
		expect(
			messagesSchema.safeParse([{ role: "user", content: "x".repeat(8001) }])
				.success,
		).toBe(false);
		expect(
			messagesSchema.safeParse([{ role: "user", content: "汉".repeat(8000) }])
				.success,
		).toBe(false);
		expect(
			messagesSchema.safeParse([{ role: "user", content: "x".repeat(8000) }])
				.success,
		).toBe(true);
		expect(
			messagesSchema.safeParse([
				{ role: "user", content: "ok", name: "injected" },
			]).success,
		).toBe(false);
	});

	it("rejects unsupported public protocol parameters and malformed bodies", () => {
		const input = { model: "test-model", messages };
		expect(publicChatInput.parse(input)).toEqual({
			...input,
			max_tokens: 512,
			stream: false,
			conversation_id: "default",
		});
		expect(
			publicChatInput.safeParse({
				...input,
				stream: true,
				stream_options: { include_usage: true },
			}).success,
		).toBe(true);
		for (const extra of [
			{ n: 2 },
			{ tools: [] },
			{ base_url: "http://internal/" },
			{ stream_options: { unexpected: true } },
		]) {
			expect(publicChatInput.safeParse({ ...input, ...extra }).success).toBe(
				false,
			);
		}
		for (const body of [null, [], "text", 1, { model: "test-model" }]) {
			expect(publicChatInput.safeParse(body).success).toBe(false);
		}
	});
});
