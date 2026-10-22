import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyMessage } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { output, runCli } from "./main";
import { resourceConfig, schemaDocument } from "./protocol";
import { CliStore, decryptSecret, readPrivate, writePrivate } from "./storage";

const directories: string[] = [];
afterEach(async () => {
	vi.unstubAllGlobals();
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});
async function temporary() {
	const directory = await mkdtemp(path.join(tmpdir(), "token2api-cli-main-"));
	directories.push(directory);
	return directory;
}
const platform = "http://127.0.0.1:3000";
const resourceId = "caaaaaaaaaaaaaaaaaaaaaaaa";
const account = mnemonicToAccount(
	"test test test test test test test test test test test junk",
);
const viewer = {
	address: account.address.toLowerCase(),
	name: "Test wallet",
	demo: false,
};
const config = {
	transport: "local",
	name: "Local gateway",
	description: "Test resource",
	model: "test-model",
	baseUrl: "http://127.0.0.1:3425/v1",
	inputRate: 1000000,
	outputRate: 2000000,
	concurrency: 1,
};
async function signedIn(directory: string) {
	const store = new CliStore("default", directory);
	await writePrivate(store.file("session.json"), {
		platform,
		address: account.address,
		cookie: "token2api_session=test-cookie",
		expiresAt: Date.now() + 60_000,
	});
	await store.rememberPlatform(platform);
	return store;
}

describe("AI CLI privacy and predictable plans", () => {
	it.each([
		"auth login",
		"auth import",
		"resource add",
		"gateway models",
		"connector configure",
		"connector start",
	])(
		"hands %s to the user before reading secrets or doing network IO",
		async (command) => {
			const fetcher = vi.fn<typeof fetch>();
			const directory = await temporary();
			const file = path.join(directory, "public.json");
			const usesFile = [
				"resource add",
				"gateway models",
				"connector configure",
			].includes(command);
			if (usesFile)
				await writeFile(
					file,
					JSON.stringify(
						command === "resource add"
							? config
							: command === "gateway models"
								? { baseUrl: config.baseUrl, transport: "local" }
								: { baseUrl: config.baseUrl },
					),
				);
			const args = [
				"--platform",
				platform,
				"--config-dir",
				directory,
				...(usesFile ? ["--file", file] : []),
				...(command.startsWith("connector ") ? ["--id", resourceId] : []),
			];
			await expect(
				runCli([...command.split(" "), ...args], { fetcher }),
			).rejects.toMatchObject({
				code: "manual_input_required",
				exitCode: 6,
				details: {
					manualCommand: [
						"token2api",
						...command.split(" "),
						...args,
						"--interactive",
					],
				},
			});
			expect(fetcher).not.toHaveBeenCalled();
		},
	);
	it("rejects command-line secrets without reflecting their values", async () => {
		const failure = await runCli([
			"auth",
			"login",
			"--private-key",
			"do-not-print-this-private-key",
		]).catch((error: unknown) => error);
		expect(output(failure)).not.toContain("do-not-print-this-private-key");
		expect(failure).toMatchObject({ code: "invalid_arguments" });
		expect(
			output({
				data: {
					privateKey: "secret",
					apiKey: "secret",
					nested: { password: "secret", cookie: "secret" },
				},
			}),
		).not.toContain('"secret"');
	});
	it("gives a complete machine-readable schema and rejects secret-bearing public configs", () => {
		expect(schemaDocument()).toMatchObject({
			exitCodes: { manual_input_required: 6 },
			schemas: { ResourceConfig: expect.any(Object) },
		});
		for (const extra of [
			{ apiKey: "secret" },
			{ privateKey: "secret" },
			{ password: "secret" },
			{ proxy: { url: "http://proxy.example:8080", username: "private" } },
			{ proxy: { url: "http://proxy.example:8080", authentication: true } },
		])
			expect(resourceConfig.safeParse({ ...config, ...extra }).success).toBe(
				false,
			);
	});
	it("previews mutations without login, secret prompts, requests or local credential writes", async () => {
		const directory = await temporary();
		const file = path.join(directory, "resource.json");
		await writeFile(file, JSON.stringify(config));
		const fetcher = vi.fn<typeof fetch>();
		const readSecret = vi.fn();
		expect(
			await runCli(
				[
					"resource",
					"add",
					"--platform",
					platform,
					"--config-dir",
					directory,
					"--file",
					file,
					"--dry-run",
				],
				{ fetcher, readSecret },
			),
		).toMatchObject({ dryRun: true, config, automaticRetry: false });
		expect(fetcher).not.toHaveBeenCalled();
		expect(readSecret).not.toHaveBeenCalled();
	});
});

describe("merchant CLI workflows", () => {
	it("signs a local SIWE challenge and saves only the session, never the wallet private key", async () => {
		const directory = await temporary();
		const key = account.getHdKey().privateKey;
		if (!key) throw new Error("Missing public test key");
		const privateKey = `0x${Buffer.from(key).toString("hex")}`;
		const now = new Date();
		const message = createSiweMessage({
			address: account.address,
			domain: "127.0.0.1:3000",
			uri: platform,
			chainId: 31337,
			nonce: "ab".repeat(24),
			version: "1",
			issuedAt: now,
			expirationTime: new Date(now.getTime() + 300_000),
			statement:
				"Sign in to Token2API. This signature does not authorize token transfers.",
		});
		const bodies: string[] = [];
		const fetcher = vi
			.fn<typeof fetch>()
			.mockImplementation(async (url, init) => {
				if (String(url).endsWith("/network"))
					return Response.json({
						mode: "local",
						chainId: 31337,
						asset: "USDC",
						tokenDecimals: 6,
						token: `0x${"22".repeat(20)}`,
						escrow: `0x${"33".repeat(20)}`,
						ledgerUnit: "micro_USDC",
						balanceUnit: "atomic",
						feeBps: 500,
						ready: true,
						rpcUrl: "http://127.0.0.1:8545",
						explorer: "",
					});
				bodies.push(String(init?.body));
				if (String(url).endsWith("/challenge"))
					return Response.json({ message });
				const body = JSON.parse(String(init?.body));
				expect(
					await verifyMessage({
						address: account.address,
						message,
						signature: body.signature,
					}),
				).toBe(true);
				return Response.json(viewer, {
					headers: {
						"Set-Cookie":
							"token2api_session=test-only-login-cookie; HttpOnly; Max-Age=28800",
					},
				});
			});
		const result = await runCli(
			["auth", "login", "--platform", platform, "--config-dir", directory],
			{ fetcher, readSecret: async () => privateKey },
		);
		expect(result).toMatchObject({
			address: viewer.address,
			privateKeyPersistedByThisLogin: false,
		});
		expect(output(result)).not.toContain(privateKey);
		expect(bodies.join(" ")).not.toContain(privateKey);
		const session = await readPrivate(
			new CliStore("default", directory).file("session.json"),
		);
		expect(JSON.stringify(session)).not.toContain(privateKey);
	});
	it("creates a local resource with encrypted scoped credentials and never uploads its upstream key", async () => {
		const directory = await temporary();
		const store = await signedIn(directory);
		const file = path.join(directory, "resource.json");
		await writeFile(file, JSON.stringify(config));
		const token = `t2c_${"z".repeat(43)}`;
		const apiKey = "manual-upstream-key";
		const bodies: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi
				.fn<typeof fetch>()
				.mockResolvedValue(Response.json({ data: [{ id: config.model }] })),
		);
		const fetcher = vi
			.fn<typeof fetch>()
			.mockImplementation(async (url, init) => {
				if (String(url).endsWith("/me")) return Response.json(viewer);
				bodies.push(String(init?.body));
				return Response.json({ id: resourceId, token });
			});
		const readSecret = vi
			.fn()
			.mockResolvedValueOnce(apiKey)
			.mockResolvedValueOnce("encryption-password")
			.mockResolvedValueOnce("encryption-password");
		const result = await runCli(
			["resource", "add", "--file", file, "--config-dir", directory],
			{ fetcher, readSecret },
		);
		expect(result).toMatchObject({
			id: resourceId,
			online: false,
			credentialSaved: true,
		});
		expect(bodies.join(" ")).not.toContain(apiKey);
		const encrypted = await readPrivate(
			store.file(`connector-${resourceId}.json`),
		);
		expect(JSON.stringify(encrypted)).not.toContain(apiKey);
		expect(JSON.stringify(encrypted)).not.toContain(token);
		expect(
			decryptSecret(
				encrypted,
				"encryption-password",
				`connector:${platform}:${resourceId}`,
			),
		).toMatchObject({ apiKey, token });
		expect(output(result)).not.toContain(token);
		expect(output(result)).not.toContain(apiKey);
	});
	it("sends direct gateway credentials only to the chosen platform and never emits them", async () => {
		const directory = await temporary();
		await signedIn(directory);
		const file = path.join(directory, "resource.json");
		await writeFile(
			file,
			JSON.stringify({
				...config,
				transport: "direct",
				baseUrl: "https://gateway.example/v1",
			}),
		);
		const bodies: string[] = [];
		const fetcher = vi
			.fn<typeof fetch>()
			.mockImplementation(async (url, init) => {
				if (String(url).endsWith("/me")) return Response.json(viewer);
				bodies.push(String(init?.body));
				return Response.json(
					String(url).endsWith("/discover")
						? { models: [config.model] }
						: { id: resourceId },
				);
			});
		const result = await runCli(
			["resource", "add", "--file", file, "--config-dir", directory],
			{ fetcher, readSecret: async () => "manually-entered-upstream-key" },
		);
		expect(
			bodies.every((body) => body.includes("manually-entered-upstream-key")),
		).toBe(true);
		expect(
			fetcher.mock.calls.every(([url]) =>
				String(url).startsWith(`${platform}/api/v1/`),
			),
		).toBe(true);
		expect(output(result)).not.toContain("manually-entered-upstream-key");
	});
	it("allows local logout even after expiration and while the platform is offline", async () => {
		const directory = await temporary();
		const store = await signedIn(directory);
		const fetcher = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new Error("offline"));
		expect(
			await runCli(["auth", "logout", "--config-dir", directory], { fetcher }),
		).toEqual({ loggedOut: true, remoteConfirmed: false });
		await expect(store.session(platform)).rejects.toMatchObject({
			code: "authentication_required",
		});
	});
});
