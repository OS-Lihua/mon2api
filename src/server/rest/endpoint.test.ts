import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "~/server/services/auth";
import {
	BODY_READ_TIMEOUT_MS,
	MAX_RAW_BODY_BYTES,
} from "~/server/services/token2api.contract";
import { publicChatInput } from "~/server/services/token2api.schema";
import { createRestMutation, createRestQuery } from "./endpoint";

const mocks = vi.hoisted(() => ({
	limitRequest: vi.fn(),
	limitCredential: vi.fn(),
	loggerError: vi.fn(),
}));

vi.mock("~/server/observability/logger", () => ({
	logger: {
		error: mocks.loggerError,
	},
}));

vi.mock("~/server/security/rate-limit", () => ({
	limitRequest: mocks.limitRequest,
	limitCredential: mocks.limitCredential,
}));

function streamRequest(
	body: ReadableStream<Uint8Array>,
	headers?: HeadersInit,
) {
	// Node's fetch requires duplex for streaming request bodies.
	const init: RequestInit & { duplex: "half" } = {
		method: "POST",
		body,
		headers,
		duplex: "half",
	};
	return new Request("https://example.com/api/v1/chat/completions", init);
}

function chunkedRequest(chunks: Uint8Array[], headers?: HeadersInit) {
	return streamRequest(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		}),
		headers,
	);
}

const encoder = new TextEncoder();

describe("REST endpoint execution", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	beforeEach(() => {
		mocks.loggerError.mockReset();
		mocks.limitRequest.mockReset();
		mocks.limitRequest.mockResolvedValue({
			limit: 60,
			remaining: 59,
			reset: 123,
			success: true,
		});
		mocks.limitCredential.mockReset();
		mocks.limitCredential.mockResolvedValue({
			limit: 600,
			remaining: 599,
			reset: 123,
			success: true,
		});
	});

	it("runs a query handler and wraps the response body", async () => {
		const handler = vi.fn(async () => ({
			body: {
				data: ["post"],
			},
		}));
		const GET = createRestQuery({
			route: "GET /api/v1/posts",
			handler,
		});

		const response = await GET(new Request("https://example.com/api/v1/posts"));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: ["post"] });
		expect(handler).toHaveBeenCalledOnce();
		expect(mocks.limitRequest).toHaveBeenCalledWith(
			expect.any(Request),
			"GET /api/v1/posts",
		);
	});

	it("returns a rate limit error before running the handler", async () => {
		mocks.limitRequest.mockResolvedValue({
			limit: 60,
			remaining: 0,
			reset: 456,
			success: false,
		});
		const handler = vi.fn(async () => ({ body: { data: [] } }));
		const GET = createRestQuery({
			route: "GET /api/v1/posts",
			handler,
		});

		const response = await GET(new Request("https://example.com/api/v1/posts"));

		expect(response.status).toBe(429);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "rate_limited",
				details: {
					limit: 60,
					remaining: 0,
					reset: 456,
				},
				message: "Too many requests",
			},
		});
		expect(handler).not.toHaveBeenCalled();
	});

	it("parses mutation input before calling the handler", async () => {
		const handler = vi.fn(async ({ input }: { input: { name: string } }) => ({
			body: {
				data: input,
			},
			init: {
				status: 201,
			},
		}));
		const POST = createRestMutation({
			route: "POST /api/v1/posts",
			input: z.object({
				name: z.string().trim().min(1),
			}),
			handler,
		});

		const response = await POST(
			new Request("https://example.com/api/v1/posts", {
				body: JSON.stringify({ name: "  Hello  " }),
				method: "POST",
			}),
		);

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({
			data: {
				name: "Hello",
			},
		});
		expect(handler).toHaveBeenCalledWith({
			input: {
				name: "Hello",
			},
			request: expect.any(Request),
		});
	});

	it("returns invalid_request for invalid JSON", async () => {
		const handler = vi.fn(async () => ({ body: { data: null } }));
		const POST = createRestMutation({
			route: "POST /api/v1/posts",
			input: z.object({
				name: z.string(),
			}),
			handler,
		});

		const response = await POST(
			new Request("https://example.com/api/v1/posts", {
				body: "{",
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "invalid_request",
				message: "Invalid JSON body",
			},
		});
		expect(handler).not.toHaveBeenCalled();
	});

	it("accepts Unicode split across byte chunks without Content-Length", async () => {
		const handler = vi.fn(async () => ({ body: { ok: true } }));
		const POST = createRestMutation({
			route: "POST /api/v1/chat/completions",
			input: publicChatInput,
			handler,
		});
		const input = {
			model: "😀".repeat(100),
			conversation_id: "😀".repeat(120),
			messages: [{ role: "user", content: "汉😀" }],
		};
		const bytes = encoder.encode(JSON.stringify(input));
		const request = chunkedRequest(
			Array.from(bytes, (byte) => Uint8Array.of(byte)),
		);
		expect(request.headers.has("content-length")).toBe(false);
		const response = await POST(request);
		expect(response.status).toBe(200);
		expect(handler).toHaveBeenCalledWith({
			input: expect.objectContaining(input),
			request,
		});
	});

	it.each([undefined, "1", String(MAX_RAW_BODY_BYTES * 10)])(
		"accepts valid input regardless of declared length %s",
		async (contentLength) => {
			const handler = vi.fn(async () => ({ body: { ok: true } }));
			const POST = createRestMutation({
				route: "POST /api/v1/posts",
				input: z.object({ name: z.string() }),
				handler,
			});
			const response = await POST(
				chunkedRequest(
					[encoder.encode('{"name":"hello"}')],
					contentLength ? { "content-length": contentLength } : undefined,
				),
			);
			expect(response.status).toBe(200);
			expect(handler).toHaveBeenCalledOnce();
		},
	);

	it.each([undefined, "1"])(
		"rejects streamed bytes over the raw limit with declared length %s before validation or business work",
		async (contentLength) => {
			const validated = vi.fn();
			const handler = vi.fn(async () => ({ body: { ok: true } }));
			const POST = createRestMutation({
				route: "POST /api/v1/posts",
				input: z.unknown().superRefine(validated),
				handler,
			});
			const request = chunkedRequest(
				[
					encoder.encode('{"name":"'),
					encoder.encode("x".repeat(MAX_RAW_BODY_BYTES)),
					encoder.encode('"}'),
				],
				contentLength ? { "content-length": contentLength } : undefined,
			);
			const response = await POST(request);
			expect(response.status).toBe(413);
			await expect(response.json()).resolves.toMatchObject({
				error: {
					code: "invalid_request",
					message: "Request body exceeds 160 KiB",
				},
			});
			expect(validated).not.toHaveBeenCalled();
			expect(handler).not.toHaveBeenCalled();
		},
	);

	it("counts raw UTF-8 bytes rather than decoded string length", async () => {
		const handler = vi.fn(async () => ({ body: { ok: true } }));
		const POST = createRestMutation({
			route: "POST /api/v1/posts",
			input: z.string(),
			handler,
		});
		const raw = JSON.stringify("😀".repeat(42_000));
		expect(raw.length).toBeLessThan(MAX_RAW_BODY_BYTES);
		expect(encoder.encode(raw).byteLength).toBeGreaterThan(MAX_RAW_BODY_BYTES);
		const response = await POST(chunkedRequest([encoder.encode(raw)]));
		expect(response.status).toBe(413);
		expect(handler).not.toHaveBeenCalled();
	});

	it("accepts exactly 160 KiB and rejects one extra raw byte", async () => {
		const handler = vi.fn(async () => ({ body: { ok: true } }));
		const POST = createRestMutation({
			route: "POST /api/v1/posts",
			input: z.unknown(),
			handler,
		});
		const body = `"${"x".repeat(MAX_RAW_BODY_BYTES - 2)}"`;
		expect((await POST(chunkedRequest([encoder.encode(body)]))).status).toBe(
			200,
		);
		expect(
			(await POST(chunkedRequest([encoder.encode(`${body} `)]))).status,
		).toBe(413);
		expect(handler).toHaveBeenCalledOnce();
	});

	it("allows JSON escapes of a valid 24000-byte messages payload", async () => {
		const handler = vi.fn(async () => ({ body: { ok: true } }));
		const POST = createRestMutation({
			route: "POST /api/v1/chat/completions",
			input: publicChatInput,
			handler,
		});
		const input = {
			model: "test",
			messages: [
				{ role: "user", content: "x".repeat(8000) },
				{ role: "user", content: "x".repeat(8000) },
				{ role: "user", content: "x".repeat(7912) },
			],
		};
		expect(Buffer.byteLength(JSON.stringify(input.messages), "utf8")).toBe(
			24000,
		);
		const raw = JSON.stringify(input).replace(/x/g, "\\u0078");
		expect(Buffer.byteLength(raw, "utf8")).toBeGreaterThan(24000);
		const response = await POST(chunkedRequest([encoder.encode(raw)]));
		expect(response.status).toBe(200);
		expect(handler).toHaveBeenCalledOnce();
	});

	it("keeps the messages byte limit below the raw body limit", async () => {
		const handler = vi.fn(async () => ({ body: { ok: true } }));
		const POST = createRestMutation({
			route: "POST /api/v1/chat/completions",
			input: publicChatInput,
			handler,
		});
		const response = await POST(
			chunkedRequest([
				encoder.encode(
					JSON.stringify({
						model: "test",
						messages: [{ role: "user", content: "汉".repeat(8000) }],
					}),
				),
			]),
		);
		expect(response.status).toBe(400);
		expect(handler).not.toHaveBeenCalled();
	});

	it("returns 400 for body stream errors without running validation or business work", async () => {
		const validated = vi.fn();
		const handler = vi.fn(async () => ({ body: { ok: true } }));
		const POST = createRestMutation({
			route: "POST /api/v1/posts",
			input: z.unknown().superRefine(validated),
			handler,
		});
		const response = await POST(
			streamRequest(
				new ReadableStream<Uint8Array>({
					pull(controller) {
						controller.error(new Error("private stream failure"));
					},
				}),
			),
		);
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: { code: "invalid_request", message: "Invalid JSON body" },
		});
		expect(validated).not.toHaveBeenCalled();
		expect(handler).not.toHaveBeenCalled();
	});

	it("returns 408 on the total deadline even when chunks keep arriving and cancellation never settles", async () => {
		vi.useFakeTimers();
		const validated = vi.fn();
		const handler = vi.fn(async () => ({ body: { ok: true } }));
		const cancel = vi.fn(() => new Promise<void>(() => undefined));
		const POST = createRestMutation({
			route: "POST /api/v1/posts",
			input: z.unknown().superRefine(validated),
			handler,
		});
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
		const responsePromise = POST(
			streamRequest(
				new ReadableStream<Uint8Array>({
					start(source) {
						controller = source;
					},
					cancel,
				}),
			),
		);
		for (let elapsed = 0; elapsed < BODY_READ_TIMEOUT_MS; elapsed += 1000) {
			controller?.enqueue(encoder.encode(" "));
			await vi.advanceTimersByTimeAsync(1000);
		}
		const response = await responsePromise;
		expect(response.status).toBe(408);
		expect(cancel).toHaveBeenCalledOnce();
		expect(validated).not.toHaveBeenCalled();
		expect(handler).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("returns 413 without waiting for a non-settling cancel callback", async () => {
		const handler = vi.fn(async () => ({ body: { ok: true } }));
		const cancel = vi.fn(() => new Promise<void>(() => undefined));
		const POST = createRestMutation({
			route: "POST /api/v1/posts",
			input: z.unknown(),
			handler,
		});
		const response = await POST(
			streamRequest(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new Uint8Array(MAX_RAW_BODY_BYTES + 1));
					},
					cancel,
				}),
			),
		);
		expect(response.status).toBe(413);
		expect(cancel).toHaveBeenCalledOnce();
		expect(handler).not.toHaveBeenCalled();
	});

	it("rejects an empty body before business work", async () => {
		const handler = vi.fn(async () => ({ body: { ok: true } }));
		const POST = createRestMutation({
			route: "POST /api/v1/posts",
			input: z.unknown(),
			handler,
		});
		const response = await POST(
			new Request("https://example.com/api/v1/posts", { method: "POST" }),
		);
		expect(response.status).toBe(400);
		expect(handler).not.toHaveBeenCalled();
	});

	it("returns invalid_request for invalid mutation input", async () => {
		const handler = vi.fn(async () => ({ body: { data: null } }));
		const POST = createRestMutation({
			route: "POST /api/v1/posts",
			input: z.object({
				name: z.string().min(1),
			}),
			handler,
		});

		const response = await POST(
			new Request("https://example.com/api/v1/posts", {
				body: JSON.stringify({ name: "" }),
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error.code).toBe("invalid_request");
		expect(body.error.message).toBe("Invalid request body");
		expect(body.error.details.fieldErrors.name).toEqual([
			"String must contain at least 1 character(s)",
		]);
		expect(handler).not.toHaveBeenCalled();
	});

	it("returns an internal error when the handler throws", async () => {
		const GET = createRestQuery({
			route: "GET /api/v1/posts",
			handler: async () => {
				throw new Error("database unavailable");
			},
		});

		const response = await GET(new Request("https://example.com/api/v1/posts"));

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "internal_error",
				message: "Unexpected server error",
			},
		});
		expect(mocks.loggerError).toHaveBeenCalledOnce();
	});

	it("does not execute the handler when the rate limit backend fails", async () => {
		mocks.limitRequest.mockRejectedValue(new Error("Redis unavailable"));
		const handler = vi.fn(async () => ({ body: { data: [] } }));
		const GET = createRestQuery({ route: "GET /api/v1/posts", handler });
		const response = await GET(new Request("https://example.com/api/v1/posts"));
		expect(response.status).toBe(500);
		expect(handler).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "internal_error", message: "Unexpected server error" },
		});
	});

	it("allows handlers to return a Response escape hatch", async () => {
		const GET = createRestQuery({
			route: "GET /api/v1/export",
			handler: async () => new Response("ok", { status: 202 }),
		});

		const response = await GET(
			new Request("https://example.com/api/v1/export"),
		);

		expect(response.status).toBe(202);
		await expect(response.text()).resolves.toBe("ok");
	});

	describe("credential-scoped limits", () => {
		const credentialRequest = (body = "{}") =>
			new Request("https://example.com/api/v1/chat/completions", {
				method: "POST",
				headers: { authorization: "Bearer t2a_test" },
				body,
			});

		it("limits a verified credential by subject instead of by IP", async () => {
			const handler = vi.fn(async () => ({ body: { ok: true } }));
			const POST = createRestMutation({
				route: "token2api:chat",
				credential: async () => "key:1",
				input: z.object({}),
				handler,
			});
			const response = await POST(credentialRequest());
			expect(response.status).toBe(200);
			expect(mocks.limitCredential).toHaveBeenCalledWith(
				"token2api:chat",
				"key:1",
			);
			expect(mocks.limitRequest).not.toHaveBeenCalled();
		});

		it("rejects an exhausted credential before the handler runs", async () => {
			mocks.limitCredential.mockResolvedValue({
				limit: 600,
				remaining: 0,
				reset: 123,
				success: false,
			});
			const handler = vi.fn(async () => ({ body: { ok: true } }));
			const POST = createRestMutation({
				route: "token2api:chat",
				credential: async () => "key:1",
				input: z.object({}),
				handler,
			});
			expect((await POST(credentialRequest())).status).toBe(429);
			expect(handler).not.toHaveBeenCalled();
		});

		it("charges failed credentials to the per-IP anonymous quota", async () => {
			const credential = vi.fn(async () => {
				throw new AppError("unauthorized", "API Key 无效或已撤销。", 401);
			});
			const POST = createRestMutation({
				route: "token2api:chat",
				credential,
				input: z.object({}),
				handler: async () => ({ body: { ok: true } }),
			});
			expect((await POST(credentialRequest())).status).toBe(401);
			expect(mocks.limitRequest).toHaveBeenLastCalledWith(
				expect.any(Request),
				"token2api:chat:anonymous",
			);
			mocks.limitRequest.mockResolvedValue({
				limit: 60,
				remaining: 0,
				reset: 123,
				success: false,
			});
			expect((await POST(credentialRequest())).status).toBe(429);
			expect(mocks.limitCredential).not.toHaveBeenCalled();
		});

		it("validates the body before authenticating a credential", async () => {
			const credential = vi.fn(async () => "key:1");
			const POST = createRestMutation({
				route: "token2api:chat",
				credential,
				input: z.object({ model: z.string() }),
				handler: async () => ({ body: { ok: true } }),
			});
			expect((await POST(credentialRequest("{}"))).status).toBe(400);
			expect(credential).not.toHaveBeenCalled();
			expect(mocks.limitRequest).toHaveBeenCalledWith(
				expect.any(Request),
				"token2api:chat:anonymous",
			);
		});

		it("keeps anonymous requests on the per-IP quota", async () => {
			const credential = vi.fn(async () => "key:1");
			const GET = createRestQuery({
				route: "token2api:models",
				credential,
				handler: async () => ({ body: { ok: true } }),
			});
			await GET(new Request("https://example.com/api/v1/models"));
			expect(credential).not.toHaveBeenCalled();
			expect(mocks.limitRequest).toHaveBeenCalledWith(
				expect.any(Request),
				"token2api:models",
			);
		});
	});
});
