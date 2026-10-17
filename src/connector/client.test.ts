import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorClient, serviceUrl } from "./client";

vi.mock("../server/services/pool-engine", async (original) => ({
	...(await original<typeof import("../server/services/pool-engine")>()),
	runEngine: vi.fn(),
}));
afterEach(() => vi.unstubAllGlobals());
describe("connector destination and credential isolation", () => {
	it("automatically discovers local models without sending the upstream key or metadata to the platform", async () => {
		const upstream = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json({
				data: [{ id: "magpie/model", privateMetadata: "private" }],
			}),
		);
		vi.stubGlobal("fetch", upstream);
		const controller = new AbortController();
		const platform = vi.fn<typeof fetch>().mockImplementation(async (url) => {
			if (String(url).endsWith("/poll")) {
				controller.abort();
				return Response.json({
					listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
					enabled: false,
					job: null,
				});
			}
			return Response.json({ ok: true });
		});
		await new ConnectorClient(
			"https://platform.example",
			"connector-token",
			platform,
		).run({
			upstream: "http://127.0.0.1:3425/v1",
			apiKey: "upstream-key",
			signal: controller.signal,
			log: () => {},
		});
		expect(upstream).toHaveBeenCalledWith(
			"http://127.0.0.1:3425/v1/models",
			expect.objectContaining({
				headers: { Authorization: "Bearer upstream-key" },
			}),
		);
		expect(platform).toHaveBeenCalledWith(
			"https://platform.example/api/v1/connector/catalog",
			expect.objectContaining({
				body: JSON.stringify({ models: ["magpie/model"] }),
			}),
		);
		for (const [, init] of platform.mock.calls) {
			expect(JSON.stringify(init)).not.toContain("upstream-key");
			expect(JSON.stringify(init)).not.toContain("privateMetadata");
		}
	});
	it.each([
		"http://remote.example/v1",
		"https://user:secret@remote.example/v1",
		"https://remote.example/v1?key=secret",
		"file:///tmp/key",
	])("rejects unsafe upstream %s", (url) => {
		expect(() => serviceUrl(url, true)).toThrow();
	});
	it("accepts explicit HTTPS upstreams and local-only HTTP", () => {
		expect(serviceUrl("http://127.0.0.1:8080/v1", true)).toBe(
			"http://127.0.0.1:8080/v1",
		);
		expect(serviceUrl("https://platform.example")).toBe(
			"https://platform.example",
		);
	});
	it("sends only the resource credential to the platform and refuses redirects", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json({
				listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
				model: "test",
				enabled: true,
				online: true,
			}),
		);
		const client = new ConnectorClient(
			"https://platform.example",
			"connector-secret",
			fetcher,
		);
		await client.status();
		expect(fetcher).toHaveBeenCalledWith(
			"https://platform.example/api/v1/connector/status",
			expect.objectContaining({
				redirect: "error",
				headers: {
					Authorization: "Bearer connector-secret",
					"Content-Type": "application/json",
				},
			}),
		);
	});
	it("never reports a private upstream exception body", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response("private credentials", { status: 500 }));
		await expect(
			new ConnectorClient(
				"https://platform.example",
				"token",
				fetcher,
			).status(),
		).rejects.toThrow("HTTP 500");
	});
});
