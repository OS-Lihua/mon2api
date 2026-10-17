import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "~/server/services/auth";
import { chatPost } from "./chat";

const mocks = vi.hoisted(() => ({
	authenticateKey: vi.fn(),
	findUnique: vi.fn(),
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
	db: { lease: { findUnique: mocks.findUnique } },
}));
vi.mock("~/server/services/market", () => ({
	authenticateKey: mocks.authenticateKey,
}));
vi.mock("~/server/services/metering", () => ({ runChat: mocks.runChat }));
vi.mock("~/server/services/runtime", () => ({
	chainConfig: () => ({ asset: "dUSD" }),
}));
vi.mock("~/env", () => ({ env: { ALLOWED_ORIGINS: "" } }));
vi.mock("~/server/security/rate-limit", () => ({
	limitRequest: mocks.limitRequest,
}));
vi.mock("~/server/observability/logger", () => ({
	logger: { error: vi.fn() },
}));

function request(stream: boolean, includeUsage = true) {
	return new Request("http://localhost/api/v1/chat/completions", {
		method: "POST",
		headers: {
			authorization: "Bearer test-key",
			"content-type": "application/json",
			"idempotency-key": "test-request-123",
		},
		body: JSON.stringify({
			model: "test-model",
			messages: [{ role: "user", content: "hello" }],
			stream,
			stream_options: { include_usage: includeUsage },
		}),
	});
}

function result(finishReason: "stop" | "length" | "content_filter") {
	return {
		id: "request-123",
		text: "answer",
		finishReason,
		inputTokens: 3,
		outputTokens: 2,
		cost: 1,
		usageSource: "upstream_reported",
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.authenticateKey.mockResolvedValue({
		id: "key-123",
		owner: "test-owner",
		sessionId: "test-session",
	});
	mocks.findUnique.mockResolvedValue({ model: "test-model" });
	mocks.limitRequest.mockResolvedValue({ success: true });
});

describe("REST chat finish reasons", () => {
	it.each(["stop", "length", "content_filter"] as const)(
		"returns %s in an ordinary completion",
		async (finishReason) => {
			mocks.runChat.mockResolvedValue(result(finishReason));
			const response = await chatPost(request(false));
			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toMatchObject({
				object: "chat.completion",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "answer" },
						finish_reason: finishReason,
					},
				],
				usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
			});
		},
	);

	it.each(["stop", "length", "content_filter"] as const)(
		"returns %s only in the terminal SSE choice, before usage and DONE",
		async (finishReason) => {
			mocks.runChat.mockImplementation(
				async (_owner, _args, onDelta: (text: string) => void) => {
					onDelta("ans");
					onDelta("wer");
					return result(finishReason);
				},
			);
			const response = await chatPost(request(true));
			expect(response.headers.get("content-type")).toContain(
				"text/event-stream",
			);
			const frames = (await response.text())
				.trim()
				.split("\n\n")
				.map((frame) => frame.slice("data: ".length));
			expect(frames.pop()).toBe("[DONE]");
			expect(frames.map((frame) => JSON.parse(frame))).toEqual([
				expect.objectContaining({
					choices: [
						{ index: 0, delta: { content: "ans" }, finish_reason: null },
					],
				}),
				expect.objectContaining({
					choices: [
						{ index: 0, delta: { content: "wer" }, finish_reason: null },
					],
				}),
				expect.objectContaining({
					choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
				}),
				expect.objectContaining({
					choices: [],
					usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
				}),
			]);
		},
	);

	it("keeps the SSE finish reason when usage chunks are disabled", async () => {
		mocks.runChat.mockResolvedValue(result("length"));
		const response = await chatPost(request(true, false));
		const body = await response.text();
		expect(body).toContain('"finish_reason":"length"');
		expect(body).not.toContain('"usage":');
		expect(body).toContain("data: [DONE]\n\n");
	});

	it.each(["usage_pending_review", "incomplete_stream", "invalid_response"])(
		"does not emit a successful SSE terminal choice for %s",
		async (code) => {
			mocks.runChat.mockImplementation(
				async (_owner, _args, onDelta: (text: string) => void) => {
					onDelta("partial");
					throw new AppError(code, "Needs review", 409);
				},
			);
			const response = await chatPost(request(true));
			const body = await response.text();
			expect(body).toContain('"finish_reason":null');
			expect(body).not.toContain('"delta":{}');
			expect(body).not.toContain('"usage":');
			expect(body).toContain(
				JSON.stringify({ error: { code, message: "Needs review" } }),
			);
			expect(body).toContain("data: [DONE]\n\n");
		},
	);

	it("continues metering after a streamed client disconnects", async () => {
		let finish: ((value: ReturnType<typeof result>) => void) | undefined;
		let reportDelta: ((text: string) => void) | undefined;
		let metered = false;
		mocks.runChat.mockImplementation(
			async (_owner, _args, onDelta: (text: string) => void) => {
				reportDelta = onDelta;
				const usage = await new Promise<ReturnType<typeof result>>(
					(resolve) => {
						finish = resolve;
					},
				);
				metered = true;
				return usage;
			},
		);
		const response = await chatPost(request(true));
		const reader = response.body?.getReader();
		if (!reader || !reportDelta || !finish)
			throw new Error("Missing stream fixture");
		reportDelta("partial");
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toContain("partial");
		await reader.cancel();
		expect(mocks.runChat.mock.calls[0]?.[3]).toBeUndefined();
		finish(result("stop"));
		await vi.waitFor(() => expect(metered).toBe(true));
	});

	it("requires a stable idempotency key before dispatching paid work", async () => {
		const missing = request(false);
		missing.headers.delete("idempotency-key");
		const response = await chatPost(missing);
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "invalid_request" },
		});
		expect(mocks.runChat).not.toHaveBeenCalled();
	});

	it("returns review errors for ordinary completions", async () => {
		mocks.runChat.mockRejectedValue(
			new AppError("usage_pending_review", "Needs review", 409),
		);
		const response = await chatPost(request(false));
		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toEqual({
			error: { code: "usage_pending_review", message: "Needs review" },
		});
	});
});
