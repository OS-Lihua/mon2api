import { describe, expect, it, vi } from "vitest";
import { discoverModels } from "./model-discovery";

describe("gateway model discovery", () => {
	it.each([
		["https://gateway.example", "https://gateway.example/v1/models"],
		[
			"https://gateway.example/api/openai/",
			"https://gateway.example/api/openai/models",
		],
		["http://127.0.0.1:9000/proxy/v1", "http://127.0.0.1:9000/proxy/v1/models"],
	])("discovers models under API base %s", async (baseUrl, expected) => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json({ data: [{ id: "model" }] }));
		await expect(
			discoverModels(baseUrl, "inference-key", fetcher),
		).resolves.toEqual(["model"]);
		expect(fetcher).toHaveBeenCalledWith(
			expected,
			expect.objectContaining({ redirect: "error" }),
		);
	});
	it("returns only unique model IDs, preserving provider prefixes and Magpie variants", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json({
				data: [
					{ id: "codex/gpt-6.1-sol", privateKey: "must-not-leave-gateway" },
					{ id: "grok/grok-4.7@500k" },
					{ id: "codex/gpt-6.1-sol" },
				],
			}),
		);
		await expect(
			discoverModels("http://127.0.0.1:3425/v1/", "local-key", fetcher),
		).resolves.toEqual(["codex/gpt-6.1-sol", "grok/grok-4.7@500k"]);
		expect(fetcher).toHaveBeenCalledWith(
			"http://127.0.0.1:3425/v1/models",
			expect.objectContaining({
				redirect: "error",
				headers: { Authorization: "Bearer local-key" },
			}),
		);
	});
	it.each([
		{ data: [] },
		{ data: [{ id: "wrong model" }] },
		{ error: "private upstream failure" },
	])("rejects empty or malformed catalogs", async (body) => {
		await expect(
			discoverModels(
				"https://gateway.example",
				"key",
				vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)),
			),
		).rejects.toThrow();
	});
	it("refuses oversized responses and hides upstream error bodies", async () => {
		await expect(
			discoverModels(
				"https://gateway.example",
				"key",
				vi
					.fn<typeof fetch>()
					.mockResolvedValue(new Response("x".repeat(512 * 1024 + 1))),
			),
		).rejects.toThrow("512 KiB");
		await expect(
			discoverModels(
				"https://gateway.example",
				"key",
				vi
					.fn<typeof fetch>()
					.mockResolvedValue(
						new Response("private credentials", { status: 401 }),
					),
			),
		).rejects.toThrow("HTTP 401");
	});
});
