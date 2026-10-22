import OpenAI from "openai";
import { gatewayApiBase } from "../../shared/gateway-url";

export const MAX_GATEWAY_TEXT_BYTES = 64 * 1024;
export const MAX_GATEWAY_RESPONSE_BYTES = 2 * 1024 * 1024;

export type EngineInput = {
	kind: "demo" | "gateway";
	/** Operator-approved gateway API base URL, never caller request input. */
	baseUrl?: string;
	apiKey?: string;
	model: string;
	messages: { role: "system" | "user" | "assistant"; content: string }[];
	maxTokens: number;
	/** Server-generated and scoped to tenant + resource, not an arbitrary client header. */
	conversationId: string;
};

export type EngineFinishReason = "stop" | "length" | "content_filter";

export type EngineResult = {
	text: string;
	finishReason: EngineFinishReason;
	inputTokens: number | null;
	outputTokens: number | null;
	usageSource: "demo" | "upstream_reported" | "missing";
	pendingReview: boolean;
	upstreamRequestId: string | null;
};

type EngineFailureCode =
	| "configuration"
	| "aborted"
	| "rate_limited"
	| "authorization"
	| "upstream_unavailable"
	| "invalid_response"
	| "incomplete_stream";

/** Safe for an API response. Upstream exception messages/bodies are never exposed. */
export class EngineFailure extends Error {
	constructor(
		public readonly code: EngineFailureCode,
		message: string,
		public readonly status: number,
		public readonly pendingReview: boolean,
		public readonly upstreamRequestId: string | null = null,
		public readonly retryAfterSeconds: number | null = null,
	) {
		super(message);
		this.name = "EngineFailure";
	}
}

type DeltaHandler = (text: string) => void | Promise<void>;

function validTokenCount(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function aborted(pendingReview: boolean, requestId: string | null = null) {
	return new EngineFailure(
		"aborted",
		"Request cancelled.",
		499,
		pendingReview,
		requestId,
	);
}

function demoUnits(text: string): number {
	// Synthetic demo accounting units, not a model tokenizer or billable real usage.
	return Math.max(1, Array.from(text).length);
}

async function runDemo(
	input: EngineInput,
	onDelta: DeltaHandler,
	signal?: AbortSignal,
): Promise<EngineResult> {
	const answer =
		"[SIMULATED DEMO · 模拟响应] Token2API routes requests to provider resources, records usage, and prepares on-chain settlement. No AI model was called.";
	const units = Array.from(answer).slice(0, input.maxTokens);
	let text = "";
	for (let i = 0; i < units.length; i += 12) {
		if (signal?.aborted) throw aborted(false);
		const delta = units.slice(i, i + 12).join("");
		text += delta;
		await onDelta(delta);
	}
	if (signal?.aborted) throw aborted(false);
	return {
		text,
		finishReason: units.length < Array.from(answer).length ? "length" : "stop",
		inputTokens: input.messages.reduce(
			(total, message) => total + demoUnits(message.content),
			0,
		),
		outputTokens: units.length,
		usageSource: "demo",
		pendingReview: false,
		upstreamRequestId: null,
	};
}

/**
 * Uses the official OpenAI SDK for SSE framing, UTF-8 decoding and cancellation.
 * gateway owns account scheduling, isolation, health checks and quota cooldowns.
 * No dispatched request is retried here: a timeout may already have incurred cost.
 * The caller validates the endpoint against its configured connector allowlist.
 */
export async function runEngine(
	input: EngineInput,
	onDelta: DeltaHandler,
	signal?: AbortSignal,
	fetcher?: typeof fetch,
): Promise<EngineResult> {
	if (signal?.aborted) throw aborted(false);
	if (!Number.isSafeInteger(input.maxTokens) || input.maxTokens < 1) {
		throw new EngineFailure(
			"configuration",
			"Invalid output limit.",
			500,
			false,
		);
	}
	if (input.kind === "demo") return runDemo(input, onDelta, signal);
	if (!input.baseUrl || !input.apiKey) {
		throw new EngineFailure(
			"configuration",
			"Provider connector is not configured.",
			503,
			false,
		);
	}
	let baseUrl: string;
	try {
		baseUrl = gatewayApiBase(input.baseUrl);
	} catch {
		throw new EngineFailure(
			"configuration",
			"Provider connector URL is invalid.",
			503,
			false,
		);
	}
	const transport = new AbortController();
	let oversizedResponse = false;
	const boundedFetch: typeof fetch = async (url, options) => {
		const response = await (fetcher ?? fetch)(url, {
			...options,
			signal: options?.signal
				? AbortSignal.any([options.signal, transport.signal])
				: transport.signal,
		});
		if (!response.body) return response;
		let bytes = 0;
		const body = response.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					bytes += chunk.byteLength;
					if (bytes > MAX_GATEWAY_RESPONSE_BYTES) {
						oversizedResponse = true;
						transport.abort();
						throw new Error("Provider response exceeds the byte limit.");
					}
					controller.enqueue(chunk);
				},
			}),
		);
		return new Response(body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	};
	const client = new OpenAI({
		apiKey: input.apiKey,
		baseURL: baseUrl,
		maxRetries: 0,
		timeout: 120_000,
		// Do not let a redirect forward the bearer credential to another host.
		fetchOptions: { redirect: "error" },
		fetch: boundedFetch,
	});
	let upstreamRequestId: string | null = null;
	let cancelStream: (() => void) | undefined;
	try {
		const response = await client.chat.completions
			.create(
				{
					model: input.model,
					messages: input.messages,
					max_tokens: input.maxTokens,
					stream: true,
					stream_options: { include_usage: true },
				},
				{
					signal,
					headers: { "x-session-id": input.conversationId },
				},
			)
			.withResponse();
		upstreamRequestId =
			response.request_id ?? response.response.headers.get("x-request-id");
		cancelStream = () => response.data.controller.abort();
		let text = "";
		let textBytes = 0;
		let finishReason: EngineFinishReason | null = null;
		let inputTokens: number | null = null;
		let outputTokens: number | null = null;
		for await (const chunk of response.data) {
			if (signal?.aborted) throw aborted(true, upstreamRequestId);
			if (!upstreamRequestId && chunk.id) upstreamRequestId = chunk.id;
			for (const choice of chunk.choices) {
				if (choice.index !== 0) continue;
				if (
					choice.delta.tool_calls?.length ||
					choice.delta.function_call ||
					choice.finish_reason === "tool_calls" ||
					choice.finish_reason === "function_call"
				) {
					throw new EngineFailure(
						"invalid_response",
						"Provider returned unsupported tool calls.",
						502,
						true,
						upstreamRequestId,
					);
				}
				if (choice.finish_reason != null) {
					if (
						choice.finish_reason !== "stop" &&
						choice.finish_reason !== "length" &&
						choice.finish_reason !== "content_filter"
					) {
						throw new EngineFailure(
							"invalid_response",
							"Provider returned an unsupported finish reason.",
							502,
							true,
							upstreamRequestId,
						);
					}
					finishReason = choice.finish_reason;
				}
				const delta = choice.delta.content;
				if (delta) {
					textBytes += Buffer.byteLength(delta, "utf8");
					if (textBytes > MAX_GATEWAY_TEXT_BYTES)
						throw new EngineFailure(
							"invalid_response",
							"Provider response text exceeds 64 KiB; usage requires review.",
							502,
							true,
							upstreamRequestId,
						);
					text += delta;
					await onDelta(delta);
					if (signal?.aborted) throw aborted(true, upstreamRequestId);
				}
			}
			if (
				chunk.usage &&
				validTokenCount(chunk.usage.prompt_tokens) &&
				validTokenCount(chunk.usage.completion_tokens)
			) {
				inputTokens = chunk.usage.prompt_tokens;
				outputTokens = chunk.usage.completion_tokens;
			}
		}
		if (signal?.aborted) throw aborted(true, upstreamRequestId);
		if (finishReason === null) {
			throw new EngineFailure(
				"incomplete_stream",
				"Provider stream ended before completion.",
				502,
				true,
				upstreamRequestId,
			);
		}
		const pendingReview = inputTokens === null || outputTokens === null;
		return {
			text,
			finishReason,
			inputTokens,
			outputTokens,
			usageSource: pendingReview ? "missing" : "upstream_reported",
			pendingReview,
			upstreamRequestId,
		};
	} catch (error) {
		if (oversizedResponse)
			throw new EngineFailure(
				"invalid_response",
				"Provider response exceeds 2 MiB; usage requires review.",
				502,
				true,
				upstreamRequestId,
			);
		if (error instanceof EngineFailure) throw error;
		if (signal?.aborted || error instanceof OpenAI.APIUserAbortError)
			throw aborted(true, upstreamRequestId);
		if (error instanceof OpenAI.APIError) {
			upstreamRequestId ??= error.requestID ?? null;
			if (error.status === 429) {
				const retry = Number(error.headers?.get("retry-after"));
				throw new EngineFailure(
					"rate_limited",
					"Provider capacity is temporarily unavailable.",
					429,
					false,
					upstreamRequestId,
					Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null,
				);
			}
			if (error.status === 401 || error.status === 403) {
				throw new EngineFailure(
					"authorization",
					"Provider connector needs authorization.",
					503,
					false,
					upstreamRequestId,
				);
			}
		}
		throw new EngineFailure(
			"upstream_unavailable",
			"Provider request failed; usage requires review.",
			502,
			true,
			upstreamRequestId,
		);
	} finally {
		transport.abort();
		cancelStream?.();
	}
}
