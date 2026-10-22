import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	endpointPolicyInput,
	endpointUrl,
	proxyInput,
} from "~/shared/gateway-config";
import { readProxy, requireGatewayAccess, sealProxy } from "./gateway-access";

const store = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("~/server/db", () => ({ db: { endpointPolicy: store } }));
vi.mock("./runtime", () => ({
	sessionPassword: () => "test-only-session-password-at-least-32-characters",
}));
beforeEach(() => {
	vi.clearAllMocks();
	store.findMany.mockResolvedValue([]);
});

describe("exact endpoint approval", () => {
	it("normalizes a bare gateway, trailing slash and default ports without dropping an explicit prefix", () => {
		expect(endpointUrl("https://Gateway.example:443/", "GATEWAY")).toBe(
			"https://gateway.example/v1",
		);
		expect(
			endpointUrl("https://gateway.example/proxy/openai/", "GATEWAY"),
		).toBe("https://gateway.example/proxy/openai");
		expect(endpointUrl("http://127.0.0.1:9000/v1/", "GATEWAY")).toBe(
			"http://127.0.0.1:9000/v1",
		);
	});
	it.each([
		"https://user:secret@gateway.example/v1",
		"https://gateway.example/v1?key=secret",
		"https://gateway.example/v1#secret",
		"https://gateway.example/v1/chat/completions",
		"http://remote.example/v1",
		"file:///etc/passwd",
	])("rejects invalid gateway %s", (url) => {
		expect(() => endpointUrl(url, "GATEWAY")).toThrow();
	});
	it("fails closed and does not authorize another prefix, port or deceptive host", async () => {
		await expect(
			requireGatewayAccess("https://gateway.example/v1"),
		).rejects.toMatchObject({ status: 403 });
		store.findMany.mockResolvedValue([
			{ kind: "GATEWAY", url: "https://gateway.example/v1" },
		]);
		await expect(
			requireGatewayAccess("https://gateway.example/v1/"),
		).resolves.toBe("https://gateway.example/v1");
		for (const url of [
			"https://gateway.example/other",
			"https://gateway.example:444/v1",
			"https://gateway.example.evil/v1",
		])
			await expect(requireGatewayAccess(url)).rejects.toMatchObject({
				code: "connector_not_allowed",
			});
	});
	it("requires separate approval for a proxy even when the gateway is approved", async () => {
		store.findMany.mockResolvedValue([
			{ kind: "GATEWAY", url: "https://gateway.example/v1" },
		]);
		await expect(
			requireGatewayAccess(
				"https://gateway.example",
				"http://proxy.example:8080",
			),
		).rejects.toMatchObject({ status: 403 });
		store.findMany.mockResolvedValue([
			{ kind: "GATEWAY", url: "https://gateway.example/v1" },
			{ kind: "PROXY", url: "http://proxy.example:8080" },
		]);
		await expect(
			requireGatewayAccess(
				"https://gateway.example",
				"http://proxy.example:8080/",
			),
		).resolves.toBe("https://gateway.example/v1");
		expect(store.findMany).toHaveBeenLastCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ enabled: true }),
			}),
		);
	});
});

describe("proxy configuration and secrets", () => {
	it("keeps authentication separate from the approved proxy origin", () => {
		expect(
			proxyInput.parse({
				url: "https://proxy.example:443/",
				username: "merchant",
				password: "secret",
			}).url,
		).toBe("https://proxy.example");
		for (const proxy of [
			{ url: "socks5://proxy.example:1080" },
			{ url: "http://user:secret@proxy.example" },
			{ url: "http://proxy.example/path" },
			{ url: "http://proxy.example?key=x" },
			{ url: "http://proxy.example", password: "secret" },
			{ url: "http://proxy.example", username: "a:b" },
			{ url: "http://proxy.example", username: "merchant", password: "secret" },
			{ url: "not-a-url", username: "merchant" },
		])
			expect(proxyInput.safeParse(proxy).success).toBe(false);
	});
	it.each([
		"http://127.0.0.1:8080",
		"http://localhost:8080",
		"http://[::1]:8080",
		"https://proxy.example:8080",
	])("permits authenticated proxy %s", (url) => {
		expect(
			proxyInput.safeParse({ url, username: "merchant", password: "secret" })
				.success,
		).toBe(true);
	});
	it("permits remote HTTP proxies without authentication", () => {
		expect(proxyInput.parse({ url: "http://proxy.example:8080" })).toEqual({
			url: "http://proxy.example:8080",
		});
	});
	it("normalizes administrator input and rejects credentials in whitelist entries", () => {
		expect(
			endpointPolicyInput.parse({
				kind: "PROXY",
				url: "https://proxy.example/",
				name: " Proxy ",
			}),
		).toMatchObject({ url: "https://proxy.example", name: "Proxy", note: "" });
		expect(
			endpointPolicyInput.safeParse({
				kind: "PROXY",
				url: "https://user:secret@proxy.example",
				name: "Proxy",
			}).success,
		).toBe(false);
	});
	it("encrypts proxy authentication and rejects damaged stored credentials", async () => {
		const proxy = {
			url: "https://proxy.example:8080",
			username: "private-user",
			password: "private-password",
		};
		const stored = await sealProxy(proxy);
		expect(JSON.stringify(stored)).not.toContain(proxy.username);
		expect(JSON.stringify(stored)).not.toContain(proxy.password);
		expect(await readProxy(stored)).toEqual(proxy);
		expect(await sealProxy()).toEqual({ proxyUrl: null, proxySecret: null });
		expect(
			await readProxy({ proxyUrl: null, proxySecret: null }),
		).toBeUndefined();
		await expect(
			readProxy({ ...stored, proxySecret: "corrupt" }),
		).rejects.toMatchObject({ code: "connector_unconfigured" });
	});
	it("blocks existing authenticated remote HTTP proxy credentials when loading a resource", async () => {
		const stored = await sealProxy({
			url: "http://proxy.example:8080",
			username: "merchant",
			password: "private-password",
		});
		await expect(readProxy(stored)).rejects.toMatchObject({
			code: "connector_unconfigured",
			status: 503,
		});
	});
});
