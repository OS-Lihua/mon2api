import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withGatewayTransport } from "./gateway-transport";
import { discoverModels } from "./model-discovery";
import { runEngine } from "./pool-engine";

const servers: Server[] = [];
const sockets = new Set<Duplex>();
async function listen(server: Server) {
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing test address");
	return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
	for (const socket of sockets) socket.destroy();
	sockets.clear();
	await Promise.all(
		servers
			.splice(0)
			.map(
				(server) =>
					new Promise<void>((resolve) => server.close(() => resolve())),
			),
	);
});

describe("real HTTP gateway proxy transport", () => {
	it("rejects an unsafe saved proxy before dispatching requests or constructing authentication", async () => {
		const action = vi.fn();
		await expect(
			withGatewayTransport(
				{
					url: "http://proxy.example:8080",
					username: "merchant",
					password: "private-password",
				},
				action,
			),
		).rejects.toThrow("HTTPS");
		expect(action).not.toHaveBeenCalled();
	});
	it("routes discovery and streamed inference through an authenticated tunnel, keeping proxy credentials out of upstream headers", async () => {
		const headers: { authorization?: string; proxy?: string }[] = [];
		const upstream = await listen(
			createServer((req, res) => {
				headers.push({
					authorization: req.headers.authorization,
					proxy: req.headers["proxy-authorization"]?.toString(),
				});
				if (req.url === "/v1/models") {
					res.setHeader("content-type", "application/json");
					res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
					return;
				}
				if (req.url !== "/v1/chat/completions") {
					res.writeHead(404).end();
					return;
				}
				res.setHeader("content-type", "text/event-stream");
				res.write(
					`data: ${JSON.stringify({ id: "upstream-1", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] })}\n\n`,
				);
				res.write(
					`data: ${JSON.stringify({ id: "upstream-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } })}\n\n`,
				);
				res.end("data: [DONE]\n\n");
			}),
		);
		const auth: (string | undefined)[] = [];
		const proxy = createServer();
		proxy.on("connect", (req, client, head) => {
			auth.push(req.headers["proxy-authorization"]?.toString());
			const destination = new URL(`http://${req.url}`);
			const socket = connect({
				host: destination.hostname,
				port: Number(destination.port),
			});
			sockets.add(client);
			sockets.add(socket);
			socket.on("error", () => client.destroy());
			client.on("error", () => socket.destroy());
			socket.on("connect", () => {
				client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
				if (head.length) socket.write(head);
				client.pipe(socket).pipe(client);
			});
		});
		const proxyUrl = await listen(proxy);
		const config = {
			url: proxyUrl,
			username: "merchant",
			password: "proxy-secret",
		};
		expect(
			await withGatewayTransport(config, (fetcher) =>
				discoverModels(`${upstream}/v1`, "upstream-key", fetcher),
			),
		).toEqual(["test-model"]);
		let text = "";
		const result = await withGatewayTransport(config, (fetcher) =>
			runEngine(
				{
					kind: "gateway",
					baseUrl: `${upstream}/v1`,
					apiKey: "upstream-key",
					model: "test-model",
					messages: [{ role: "user", content: "hello" }],
					maxTokens: 128,
					conversationId: "scoped-conversation",
				},
				(delta) => {
					text += delta;
				},
				undefined,
				fetcher,
			),
		);
		expect(text).toBe("Hello");
		expect(result).toMatchObject({
			inputTokens: 3,
			outputTokens: 2,
			pendingReview: false,
		});
		expect(auth).toHaveLength(2);
		expect(
			auth.every(
				(value) =>
					value ===
					`Basic ${Buffer.from("merchant:proxy-secret").toString("base64")}`,
			),
		).toBe(true);
		expect(headers).toEqual([
			{ authorization: "Bearer upstream-key", proxy: undefined },
			{ authorization: "Bearer upstream-key", proxy: undefined },
		]);
		// Omitting the optional proxy really makes a direct request.
		await withGatewayTransport(undefined, (fetcher) =>
			discoverModels(`${upstream}/v1`, "direct-key", fetcher),
		);
		expect(auth).toHaveLength(2);
		expect(headers.at(-1)?.authorization).toBe("Bearer direct-key");
	});
	it("does not fall back to direct access if the chosen proxy refuses authentication", async () => {
		let calls = 0;
		const upstream = await listen(
			createServer((_req, res) => {
				calls++;
				res.end(JSON.stringify({ data: [{ id: "model" }] }));
			}),
		);
		const rejecting = createServer();
		rejecting.on("connect", (_req, client) => {
			sockets.add(client);
			client.end(
				"HTTP/1.1 407 Proxy Authentication Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
			);
		});
		const url = await listen(rejecting);
		await expect(
			withGatewayTransport({ url }, (fetcher) =>
				discoverModels(`${upstream}/v1`, "secret", fetcher),
			),
		).rejects.toThrow();
		expect(calls).toBe(0);
	});
});
