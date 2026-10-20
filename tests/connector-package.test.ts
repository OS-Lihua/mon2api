import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import manifest from "../packages/connector/package.json";
import { buildConnector } from "../scripts/build-connector.mjs";
import { connectorUpdate } from "../src/shared/connector";
import {
	connectorDownloadPath,
	connectorStartCommand,
} from "../src/shared/connector-distribution";

const exec = promisify(execFile);
const token = `t2c_${"a".repeat(43)}`;
const launchCode = `t2l_${"b".repeat(43)}`;
let launchUsed = false;
const apiKey = "test-only-private-upstream-key";
let emptyDir: string;
let archive: string;
let server: Server;
let platform: string;
let complete: Promise<void>;
let disconnected: Promise<void>;
let receivedComplete: () => void;
let receivedDisconnect: () => void;
const failures: unknown[] = [];
const updates: unknown[] = [];
let upstreamCalls = 0;
let claimed = false;

async function listen() {
	server = createServer(async (req, res) => {
		try {
			const localUpstream = req.url?.startsWith("/v1/");
			expect(req.headers.authorization).toBe(
				`Bearer ${localUpstream ? apiKey : req.url === "/api/v1/connector/connect" ? launchCode : token}`,
			);
			let body = "";
			for await (const chunk of req) body += chunk;
			if (!localUpstream) expect(body).not.toContain(apiKey);
			res.setHeader("Content-Type", "application/json");
			switch (req.url) {
				case "/api/v1/connector/connect":
					if (launchUsed) {
						res.statusCode = 401;
						res.end(JSON.stringify({ error: { code: "unauthorized" } }));
						return;
					}
					launchUsed = true;
					res.end(JSON.stringify({ token }));
					return;
				case "/api/v1/connector/status":
					res.end(
						JSON.stringify({
							listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
							model: "local-test-model",
							enabled: true,
							online: true,
						}),
					);
					return;
				case "/v1/models":
					res.end(
						JSON.stringify({
							data: [{ id: "local-test-model", privateMetadata: apiKey }],
						}),
					);
					return;
				case "/api/v1/connector/catalog":
					expect(JSON.parse(body)).toEqual({ models: ["local-test-model"] });
					break;
				case "/api/v1/connector/poll": {
					const job = claimed
						? null
						: {
								id: "cbbbbbbbbbbbbbbbbbbbbbbbb",
								input: {
									model: "local-test-model",
									messages: [{ role: "user", content: "Hello" }],
									maxTokens: 128,
									conversationId: "b".repeat(64),
								},
								expiresAt: new Date(Date.now() + 40_000).toISOString(),
							};
					claimed = true;
					res.end(
						JSON.stringify({
							listingId: "caaaaaaaaaaaaaaaaaaaaaaaa",
							enabled: true,
							job,
						}),
					);
					return;
				}
				case "/v1/chat/completions": {
					upstreamCalls++;
					expect(JSON.parse(body)).toMatchObject({
						model: "local-test-model",
						stream: true,
					});
					res.setHeader("Content-Type", "text/event-stream");
					res.setHeader("x-request-id", "package-test-request");
					const chunks = [
						{
							id: "chatcmpl-test",
							choices: [
								{
									index: 0,
									delta: { content: "connector works" },
									finish_reason: null,
								},
							],
						},
						{
							id: "chatcmpl-test",
							choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
							usage: {
								prompt_tokens: 3,
								completion_tokens: 4,
								total_tokens: 7,
							},
						},
					];
					res.end(
						`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
					);
					return;
				}
				case "/api/v1/connector/updates": {
					const update = connectorUpdate.parse(JSON.parse(body));
					updates.push(update);
					if (update.event === "complete") receivedComplete();
					break;
				}
				case "/api/v1/connector/disconnect":
					receivedDisconnect();
					break;
				default:
					throw new Error(`Unexpected request: ${req.url}`);
			}
			res.end(JSON.stringify({ ok: true }));
		} catch (error) {
			failures.push(error);
			res.statusCode = 500;
			res.end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No test port");
	platform = `http://127.0.0.1:${address.port}`;
}

beforeAll(async () => {
	emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "token2api-package-"));
	archive = await buildConnector();
	complete = new Promise<void>((resolve) => {
		receivedComplete = resolve;
	});
	disconnected = new Promise<void>((resolve) => {
		receivedDisconnect = resolve;
	});
	await listen();
}, 30_000);

afterAll(async () => {
	server?.closeAllConnections();
	if (server)
		await new Promise<void>((resolve) => server.close(() => resolve()));
	if (emptyDir) await fs.rm(emptyDir, { recursive: true, force: true });
});

describe("standalone connector distribution", () => {
	it("installs the platform-hosted package and runs from a directory without project files", async () => {
		// Serve the actual archive, just as Next serves public/downloads in production.
		const download = createServer(async (_req, res) =>
			res.end(await fs.readFile(archive)),
		);
		await new Promise<void>((resolve) =>
			download.listen(0, "127.0.0.1", resolve),
		);
		try {
			const address = download.address();
			if (!address || typeof address === "string")
				throw new Error("No download port");
			const origin = `http://127.0.0.1:${address.port}`;
			const command = connectorStartCommand(origin);
			expect(command).toContain(`--package=${origin}${connectorDownloadPath}`);
			const completeCommand = connectorStartCommand(
				origin,
				undefined,
				launchCode,
			);
			expect(completeCommand).toContain(`--connect-code ${launchCode}`);
			expect(completeCommand).not.toContain(token);
			expect(completeCommand).not.toContain(apiKey);
			const { stdout } = await exec(
				"npm",
				[
					"exec",
					"--yes",
					"--cache",
					path.join(emptyDir, "cache"),
					`--package=${origin}${connectorDownloadPath}`,
					"--",
					"token2api-connector",
					"--help",
				],
				{ cwd: emptyDir, timeout: 20_000 },
			);
			expect(stdout).toContain("token2api-connector start");
			expect(stdout).not.toContain("pnpm connector");
			expect(await fs.readdir(emptyDir)).toEqual(["cache"]);
		} finally {
			download.closeAllConnections();
			await new Promise<void>((resolve) => download.close(() => resolve()));
		}
	}, 30_000);

	it("packs only the standalone executable, metadata and license files", async () => {
		const { stdout } = await exec("tar", ["-tzf", archive]);
		expect(stdout.trim().split("\n").sort()).toEqual(
			[
				"package/LICENSE",
				"package/README.md",
				"package/THIRD_PARTY_LICENSES.txt",
				"package/dist/connector.mjs",
				"package/package.json",
			].sort(),
		);
		expect(manifest).not.toHaveProperty("dependencies");
		expect(manifest).not.toHaveProperty("scripts");
	});

	it("preserves status, discovery, streaming usage and graceful shutdown after isolated installation", async () => {
		const install = path.join(emptyDir, "installed");
		await exec(
			"npm",
			[
				"install",
				"--prefix",
				install,
				"--offline",
				"--ignore-scripts",
				"--no-audit",
				"--no-fund",
				archive,
			],
			{ cwd: emptyDir, timeout: 20_000 },
		);
		const bin = path.join(
			install,
			"node_modules",
			"@token2api",
			"connector",
			"dist",
			"connector.mjs",
		);
		const { stdout: version } = await exec(
			process.execPath,
			[bin, "--version"],
			{ cwd: emptyDir },
		);
		expect(version.trim()).toBe(manifest.version);
		const { stdout: status } = await exec(
			process.execPath,
			[bin, "status", "--platform", platform],
			{
				cwd: emptyDir,
				env: { ...process.env, TOKEN2API_CONNECTOR_TOKEN: token },
			},
		);
		expect(JSON.parse(status)).toMatchObject({
			online: true,
			model: "local-test-model",
		});

		const child = spawn(
			process.execPath,
			[
				bin,
				"start",
				"--platform",
				platform,
				"--upstream",
				`${platform}/v1`,
				"--connect-code",
				launchCode,
			],
			{
				cwd: emptyDir,
				stdio: "pipe",
				env: {
					...process.env,
					TOKEN2API_CONNECTOR_TOKEN: "",
					TOKEN2API_UPSTREAM_KEY: apiKey,
				},
			},
		);
		let output = "";
		child.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		const exited = new Promise<number | null>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", resolve);
		});
		child.stdin.end();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const timedOut = new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`Connector timed out: ${output}`)),
					12_000,
				);
			});
			await Promise.race([
				complete,
				timedOut,
				exited.then((code) => {
					throw new Error(`Unexpected exit ${code}: ${output}`);
				}),
			]);
			child.kill("SIGTERM");
			expect(await Promise.race([exited, timedOut])).toBe(0);
			await Promise.race([disconnected, timedOut]);
			expect(upstreamCalls).toBe(1);
			expect(launchUsed).toBe(true);
			expect(updates).toContainEqual(
				expect.objectContaining({
					event: "complete",
					text: "connector works",
					result: expect.objectContaining({
						inputTokens: 3,
						outputTokens: 4,
						usageSource: "upstream_reported",
						pendingReview: false,
					}),
				}),
			);
			expect(failures).toEqual([]);
			expect(output).not.toContain(token);
			expect(output).not.toContain(apiKey);
			expect(output).not.toContain(launchCode);
		} finally {
			clearTimeout(timer);
			if (child.exitCode === null) child.kill("SIGKILL");
			await exited;
		}
	}, 30_000);
});
