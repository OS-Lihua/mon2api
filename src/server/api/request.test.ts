import { createTRPCUntypedClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "~/app/api/trpc/[trpc]/route";
import {
	BODY_READ_TIMEOUT_MS,
	MAX_RAW_BODY_BYTES,
} from "~/server/services/token2api.contract";
import { MAX_TRPC_BATCH_SIZE } from "~/shared/trpc-limits";

const mocks = vi.hoisted(() => ({
	run: vi.fn(() => "ok"),
	context: vi.fn(async () => ({})),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("~/server/observability/logger", () => ({
	logger: { error: vi.fn() },
}));
vi.mock("~/server/api/trpc", () => ({ createTRPCContext: mocks.context }));
vi.mock("~/server/api/root", async () => {
	const { initTRPC } = await import("@trpc/server");
	const { default: superjson } = await import("superjson");
	const { z } = await import("zod");
	const t = initTRPC.create({ transformer: superjson });
	return {
		appRouter: t.router({
			read: t.procedure.input(z.unknown()).query(mocks.run),
			write: t.procedure.input(z.unknown()).mutation(mocks.run),
		}),
	};
});

const origin = "https://example.com/api/trpc";
function post(
	body: string | ReadableStream<Uint8Array>,
	path = "write",
	headers: Record<string, string> = {},
) {
	const init = {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body,
		duplex: "half",
	};
	return new Request(`${origin}/${path}`, init);
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("actual tRPC route input limits", () => {
	const contentLengthCases: Record<string, string>[] = [
		{},
		{ "content-length": "1" },
	];
	it.each(contentLengthCases)(
		"rejects oversized streamed bodies before parsing or running context (headers=%j)",
		async (headers) => {
			const cancel = vi.fn();
			let reads = 0;
			const request = post(
				new ReadableStream<Uint8Array>({
					pull(controller) {
						reads++;
						controller.enqueue(new Uint8Array(8192).fill(32));
					},
					cancel,
				}),
				"write",
				headers,
			);
			const response = await POST(request);
			expect(response.status).toBe(413);
			expect(await response.json()).toMatchObject({
				error: {
					json: { data: { code: "PAYLOAD_TOO_LARGE", httpStatus: 413 } },
				},
			});
			expect(cancel).toHaveBeenCalledOnce();
			expect(reads).toBeLessThanOrEqual(MAX_RAW_BODY_BYTES / 8192 + 2);
			expect(mocks.context).not.toHaveBeenCalled();
			expect(mocks.run).not.toHaveBeenCalled();
		},
	);
	it("returns a limit error that the real tRPC batch client can deserialize", async () => {
		const client = createTRPCUntypedClient({
			links: [
				httpBatchLink({
					url: origin,
					transformer: superjson,
					fetch: (input, init) => POST(new Request(input, init)),
				}),
			],
		});
		await expect(
			client.mutation("write", "x".repeat(MAX_RAW_BODY_BYTES + 1)),
		).rejects.toMatchObject({
			data: { code: "PAYLOAD_TOO_LARGE", httpStatus: 413 },
		});
		expect(mocks.context).not.toHaveBeenCalled();
	});
	it("accepts exactly 160 KiB, preserving headers and normal JSON deserialization", async () => {
		const prefix = '{"json":"';
		const suffix = '"}';
		const body =
			prefix +
			"x".repeat(MAX_RAW_BODY_BYTES - prefix.length - suffix.length) +
			suffix;
		const response = await POST(post(body));
		expect(response.status).toBe(200);
		expect(mocks.run).toHaveBeenCalledOnce();
		expect(mocks.context).toHaveBeenCalledWith(
			expect.objectContaining({ headers: expect.any(Headers) }),
		);
	});
	it("accepts framework-wrapped requests without accessing their private state", async () => {
		const request = new Proxy(
			post(JSON.stringify({ json: { message: "bounded" } }), "write", {
				cookie: "token2api_session=local-test",
			}),
			{
				get(target, property) {
					const value: unknown = Reflect.get(target, property, target);
					return typeof value === "function" ? value.bind(target) : value;
				},
			},
		);
		const response = await POST(request);
		expect(response.status).toBe(200);
		expect(mocks.run).toHaveBeenCalledOnce();
		expect(mocks.context).toHaveBeenCalledWith(
			expect.objectContaining({ headers: expect.any(Headers) }),
		);
	});
	it("counts UTF-8 bytes rather than characters", async () => {
		const response = await POST(
			post(
				JSON.stringify({
					json: "汉".repeat(Math.ceil(MAX_RAW_BODY_BYTES / 3)),
				}),
			),
		);
		expect(response.status).toBe(413);
		expect(mocks.run).not.toHaveBeenCalled();
	});
	it("times out slow bodies without waiting for a stalled cancel callback", async () => {
		vi.useFakeTimers();
		const cancel = vi.fn(() => new Promise<void>(() => {}));
		const response = POST(post(new ReadableStream<Uint8Array>({ cancel })));
		await vi.advanceTimersByTimeAsync(BODY_READ_TIMEOUT_MS + 1);
		expect((await response).status).toBe(408);
		expect(cancel).toHaveBeenCalledOnce();
		expect(mocks.context).not.toHaveBeenCalled();
		expect(mocks.run).not.toHaveBeenCalled();
	});
	it("rejects an excessive batch before reading its body, including encoded separators", async () => {
		const cancel = vi.fn();
		const path = Array.from(
			{ length: MAX_TRPC_BATCH_SIZE + 1 },
			() => "write",
		).join("%2C");
		const request = post(
			new ReadableStream<Uint8Array>({ cancel }),
			`${path}?batch=1`,
		);
		if (!request.body) throw new Error("Missing test request body");
		const read = vi.spyOn(request.body, "getReader");
		expect((await POST(request)).status).toBe(400);
		expect(read).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledOnce();
		expect(mocks.context).not.toHaveBeenCalled();
	});
	it("continues to execute valid batches and GET queries", async () => {
		expect(
			(
				await POST(
					post(
						JSON.stringify({ "0": { json: null }, "1": { json: null } }),
						"write,write?batch=1",
					),
				)
			).status,
		).toBe(200);
		expect(mocks.run).toHaveBeenCalledTimes(2);
		expect(
			(
				await GET(
					new Request(
						`${origin}/read?input=${encodeURIComponent(JSON.stringify({ json: "hello" }))}`,
					),
				)
			).status,
		).toBe(200);
		expect(mocks.run).toHaveBeenCalledTimes(3);
	});
	it("limits GET inputs too", async () => {
		const response = await GET(
			new Request(`${origin}/read?input=${"x".repeat(MAX_RAW_BODY_BYTES + 1)}`),
		);
		expect(response.status).toBe(413);
		expect(mocks.context).not.toHaveBeenCalled();
	});
});
