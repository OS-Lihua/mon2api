import { afterEach, describe, expect, it, vi } from "vitest";
import {
	EngineFailure,
	type EngineInput,
	MAX_GATEWAY_RESPONSE_BYTES,
	MAX_GATEWAY_TEXT_BYTES,
	runEngine,
} from "./pool-engine";

const input: EngineInput = {
	kind: "gateway",
	baseUrl: "http://127.0.0.1:8787",
	apiKey: "test-connector-secret",
	model: "provider-model",
	messages: [{ role: "user", content: "hello" }],
	maxTokens: 128,
	conversationId: "tenant-a:resource-b:conversation-c",
};

function event(data: unknown) {
	return `data: ${typeof data === "string" ? data : JSON.stringify(data)}\r\n\r\n`;
}

function completion(content: string, finish: string | null = null) {
	return {
		id: "chatcmpl-upstream",
		object: "chat.completion.chunk",
		choices: [{ index: 0, delta: { content }, finish_reason: finish }],
	};
}

function mockSse(body: string, singleByteChunks = false) {
	const bytes = new TextEncoder().encode(body);
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				if (singleByteChunks) {
					for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
				} else controller.enqueue(bytes);
				controller.close();
			},
		}),
		{
			headers: {
				"content-type": "text/event-stream",
				"x-request-id": "request-123",
			},
		},
	);
}

afterEach(() => vi.unstubAllGlobals());

describe("gateway engine through the official OpenAI SDK", () => {
	it("rejects cumulative UTF-8 text above 64 KiB before emitting the excess and retains review", async () => {
		const allowed = "汉".repeat(Math.floor(MAX_GATEWAY_TEXT_BYTES / 3));
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				mockSse(
					event(completion(allowed)) +
						event(completion("汉", "stop")) +
						event("[DONE]"),
				),
			);
		const emit = vi.fn();
		await expect(
			runEngine(input, emit, undefined, fetcher),
		).rejects.toMatchObject({
			code: "invalid_response",
			pendingReview: true,
			status: 502,
		});
		expect(emit).toHaveBeenCalledExactlyOnceWith(allowed);
		expect(fetcher).toHaveBeenCalledOnce();
	});
	it("accepts text at the exact byte limit with normal final usage", async () => {
		const text = "x".repeat(MAX_GATEWAY_TEXT_BYTES);
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			mockSse(
				event(completion(text, "stop")) +
					event({
						choices: [],
						usage: { prompt_tokens: 1, completion_tokens: 128 },
					}) +
					event("[DONE]"),
			),
		);
		await expect(
			runEngine(input, () => {}, undefined, fetcher),
		).resolves.toMatchObject({ text, pendingReview: false });
	});
	it.each([200, 429])(
		"bounds a streaming HTTP %s body before SSE or error JSON parsing, cancels it and never retries",
		async (status) => {
			const cancel = vi.fn();
			let bytes = 0;
			const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
				new Response(
					new ReadableStream<Uint8Array>({
						pull(controller) {
							bytes += 16384;
							controller.enqueue(new Uint8Array(16384).fill(120));
						},
						cancel,
					}),
					{
						status,
						headers: {
							"content-type":
								status === 200 ? "text/event-stream" : "application/json",
							"content-length": "1",
						},
					},
				),
			);
			const emit = vi.fn();
			await expect(
				runEngine(input, emit, undefined, fetcher),
			).rejects.toMatchObject({
				code: "invalid_response",
				pendingReview: true,
				status: 502,
			});
			await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
			expect(bytes).toBeLessThanOrEqual(MAX_GATEWAY_RESPONSE_BYTES + 3 * 16384);
			expect(emit).not.toHaveBeenCalled();
			expect(fetcher).toHaveBeenCalledOnce();
		},
	);
	it("cancels a still-open stream after excessive text", async () => {
		const cancel = vi.fn();
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								event(completion("x".repeat(MAX_GATEWAY_TEXT_BYTES + 1))),
							),
						);
					},
					cancel,
				}),
				{ headers: { "content-type": "text/event-stream" } },
			),
		);
		await expect(
			runEngine(input, () => {}, undefined, fetcher),
		).rejects.toMatchObject({ code: "invalid_response", pendingReview: true });
		await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
	});
	it("calls a custom API prefix without appending another version path", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			mockSse(
				event(completion("answer", "stop")) +
					event({
						choices: [],
						usage: { prompt_tokens: 3, completion_tokens: 2 },
					}) +
					event("[DONE]"),
			),
		);
		vi.stubGlobal("fetch", fetcher);
		await expect(
			runEngine(
				{ ...input, baseUrl: "https://gateway.example/api/openai/" },
				() => {},
			),
		).resolves.toMatchObject({ text: "answer", pendingReview: false });
		expect(fetcher).toHaveBeenCalledWith(
			"https://gateway.example/api/openai/chat/completions",
			expect.objectContaining({ redirect: "error" }),
		);
	});
	it("handles fragmented SSE and UTF-8, records upstream usage, and sends scoped sticky identity", async () => {
		const fetcher = vi.fn().mockResolvedValue(
			mockSse(
				event(completion("你好")) +
					event(completion(" world", "stop")) +
					event({
						choices: [],
						usage: {
							prompt_tokens: 31,
							completion_tokens: 5,
							total_tokens: 36,
						},
					}) +
					event("[DONE]"),
				true,
			),
		);
		vi.stubGlobal("fetch", fetcher);
		const deltas: string[] = [];
		const result = await runEngine(input, (delta) => {
			deltas.push(delta);
		});
		expect(result).toEqual({
			text: "你好 world",
			finishReason: "stop",
			inputTokens: 31,
			outputTokens: 5,
			usageSource: "upstream_reported",
			pendingReview: false,
			upstreamRequestId: "request-123",
		});
		expect(deltas.join("")).toBe(result.text);
		expect(fetcher).toHaveBeenCalledOnce();
		const [url, options] = fetcher.mock.calls[0] as [string, RequestInit];
		expect(String(url)).toBe("http://127.0.0.1:8787/v1/chat/completions");
		expect(new Headers(options.headers).get("x-session-id")).toBe(
			input.conversationId,
		);
		expect(options.redirect).toBe("error");
		expect(JSON.parse(String(options.body))).toMatchObject({
			stream: true,
			stream_options: { include_usage: true },
			max_tokens: 128,
		});
	});

	it.each(["stop", "length", "content_filter"])(
		"preserves the upstream %s finish reason",
		async (finishReason) => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(
					mockSse(
						event(completion("answer", finishReason)) +
							event({
								choices: [],
								usage: { prompt_tokens: 3, completion_tokens: 2 },
							}) +
							event("[DONE]"),
					),
				),
			);
			await expect(runEngine(input, () => {})).resolves.toMatchObject({
				text: "answer",
				finishReason,
				inputTokens: 3,
				outputTokens: 2,
				pendingReview: false,
			});
		},
	);

	it.each(["tool_calls", "function_call", "unknown", ""])(
		"rejects unsupported finish reason %j and retains review",
		async (finishReason) => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue(
					mockSse(
						event(completion("answer", finishReason)) +
							event({
								choices: [],
								usage: { prompt_tokens: 3, completion_tokens: 2 },
							}) +
							event("[DONE]"),
					),
				),
			);
			await expect(runEngine(input, () => {})).rejects.toMatchObject({
				code: "invalid_response",
				status: 502,
				pendingReview: true,
			});
		},
	);

	it.each([
		{ tool_calls: [{ index: 0, id: "call-1", type: "function" }] },
		{ function_call: { name: "unsupported", arguments: "{}" } },
	])("rejects tool call deltas before emitting text", async (toolDelta) => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				mockSse(
					event({
						choices: [
							{
								index: 0,
								delta: { ...toolDelta, content: "unsupported" },
								finish_reason: null,
							},
						],
					}) + event("[DONE]"),
				),
			),
		);
		const onDelta = vi.fn();
		await expect(runEngine(input, onDelta)).rejects.toMatchObject({
			code: "invalid_response",
			pendingReview: true,
		});
		expect(onDelta).not.toHaveBeenCalled();
	});

	it.each(["stop", "length", "content_filter"])(
		"keeps missing usage for %s in review",
		async (finishReason) => {
			vi.stubGlobal(
				"fetch",
				vi
					.fn()
					.mockResolvedValue(
						mockSse(
							event(completion("answer", finishReason)) + event("[DONE]"),
						),
					),
			);
			const result = await runEngine(input, () => {});
			expect(result).toMatchObject({
				text: "answer",
				finishReason,
				inputTokens: null,
				outputTokens: null,
				usageSource: "missing",
				pendingReview: true,
			});
		},
	);

	it("holds invalid token counts for review", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				mockSse(
					event(completion("answer", "stop")) +
						event({
							choices: [],
							usage: { prompt_tokens: -1, completion_tokens: 4 },
						}) +
						event("[DONE]"),
				),
			),
		);
		expect(await runEngine(input, () => {})).toMatchObject({
			inputTokens: null,
			outputTokens: null,
			pendingReview: true,
		});
	});

	it("does not retry 429 and never exposes the provider error body or key", async () => {
		const fetcher = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					error: { message: "private provider detail test-connector-secret" },
				}),
				{
					status: 429,
					headers: {
						"content-type": "application/json",
						"retry-after": "30",
						"x-request-id": "limited-123",
					},
				},
			),
		);
		vi.stubGlobal("fetch", fetcher);
		try {
			await runEngine(input, () => {});
			expect.fail("expected capacity failure");
		} catch (error) {
			expect(error).toBeInstanceOf(EngineFailure);
			expect(error).toMatchObject({
				code: "rate_limited",
				status: 429,
				pendingReview: false,
				retryAfterSeconds: 30,
				upstreamRequestId: "limited-123",
			});
			expect(String(error)).not.toContain("test-connector-secret");
			expect(String(error)).not.toContain("private provider detail");
		}
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it("cancels the stream when the downstream request aborts and retains a review flag", async () => {
		const controller = new AbortController();
		const cancelled = vi.fn();
		const bytes = new TextEncoder().encode(event(completion("partial")));
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					new ReadableStream<Uint8Array>({
						start(stream) {
							stream.enqueue(bytes);
						},
						cancel: cancelled,
					}),
					{ headers: { "content-type": "text/event-stream" } },
				),
			),
		);
		await expect(
			runEngine(
				input,
				() => {
					controller.abort();
				},
				controller.signal,
			),
		).rejects.toMatchObject({ code: "aborted", pendingReview: true });
		expect(cancelled).toHaveBeenCalledOnce();
	});

	it("rejects a truncated stream even when it contains usage", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				mockSse(
					event(completion("partial")) +
						event({
							choices: [],
							usage: { prompt_tokens: 1, completion_tokens: 2 },
						}),
				),
			),
		);
		await expect(runEngine(input, () => {})).rejects.toMatchObject({
			code: "incomplete_stream",
			pendingReview: true,
		});
	});

	it("does not dispatch an already aborted request", async () => {
		const controller = new AbortController();
		controller.abort();
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		await expect(
			runEngine(input, () => {}, controller.signal),
		).rejects.toMatchObject({ code: "aborted", pendingReview: false });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("requires connector configuration without attempting a request", async () => {
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		await expect(
			runEngine({ ...input, apiKey: undefined }, () => {}),
		).rejects.toMatchObject({ code: "configuration", pendingReview: false });
		expect(fetcher).not.toHaveBeenCalled();
	});
});

describe("deterministic demo engine", () => {
	it("reports length when the synthetic answer reaches the output limit", async () => {
		const result = await runEngine(
			{ ...input, kind: "demo", maxTokens: 128 },
			() => {},
		);
		expect(result).toMatchObject({ finishReason: "length", outputTokens: 128 });
	});

	it("explicitly labels synthetic output and usage without invoking an upstream", async () => {
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		const first = await runEngine(
			{ ...input, kind: "demo", maxTokens: 256 },
			() => {},
		);
		const second = await runEngine(
			{ ...input, kind: "demo", maxTokens: 256 },
			() => {},
		);
		expect(first).toEqual(second);
		expect(first.text).toContain("SIMULATED DEMO");
		expect(first.text).toContain("No AI model was called");
		expect(first).toMatchObject({
			usageSource: "demo",
			finishReason: "stop",
			pendingReview: false,
			upstreamRequestId: null,
		});
		expect(fetcher).not.toHaveBeenCalled();
	});
});
