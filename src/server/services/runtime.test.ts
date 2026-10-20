import { afterEach, describe, expect, it, vi } from "vitest";
import {
	chainConfig,
	demoEnabled,
	ensureChainBinding,
	resetRuntimeCaches,
	runtimeDirectory,
} from "./runtime";

const bindingStore = vi.hoisted(() => ({ upsert: vi.fn() }));
vi.mock("~/server/db", () => ({ db: { chainBinding: bindingStore } }));

const addresses = {
	token: `0x${"11".repeat(20)}`,
	escrow: `0x${"22".repeat(20)}`,
};

function config(mode: "local" | "evm") {
	return JSON.stringify({
		mode,
		asset: "USDC",
		tokenDecimals: 6,
		chainId: mode === "local" ? 31337 : 1,
		rpcUrl: mode === "local" ? "http://127.0.0.1:8545" : "https://rpc.example",
		...addresses,
		deploymentBlock: "1",
	});
}

afterEach(() => {
	vi.unstubAllEnvs();
	resetRuntimeCaches();
});

describe("demo identity chain boundary", () => {
	it("defaults the data directory to Base USDC and rejects implicit local deployments", () => {
		vi.stubEnv("TOKEN2API_MODE", "");
		vi.stubEnv("TOKEN2API_DATA_DIR", "");
		vi.stubEnv("SETTLEMENT_CHAIN_ID", "");
		vi.stubEnv("SETTLEMENT_ASSET", "");
		vi.stubEnv("CHAIN_CONFIG_JSON", config("evm"));
		expect(chainConfig().chainId).toBe(1);
		expect(runtimeDirectory()).toMatch(/\.runtime\/evm\/8453-usdc$/);
		vi.stubEnv("CHAIN_CONFIG_JSON", config("local"));
		expect(() => chainConfig()).toThrow("TOKEN2API_MODE does not match");
	});
	it("rejects an unlisted settlement chain", () => {
		vi.stubEnv("TOKEN2API_MODE", "evm");
		vi.stubEnv(
			"CHAIN_CONFIG_JSON",
			JSON.stringify({ ...JSON.parse(config("evm")), chainId: 143 }),
		);
		expect(() => chainConfig()).toThrow("Unsupported settlement chain");
	});
	it("enables the public demo only for a matching loopback deployment", () => {
		vi.stubEnv("ALLOW_DEMO", "true");
		vi.stubEnv("TOKEN2API_MODE", "local");
		vi.stubEnv("CHAIN_CONFIG_JSON", config("local"));
		expect(demoEnabled()).toBe(true);
	});

	it("rejects an environment mode that disagrees with the deployed network", () => {
		vi.stubEnv("ALLOW_DEMO", "true");
		vi.stubEnv("TOKEN2API_MODE", "local");
		vi.stubEnv("CHAIN_CONFIG_JSON", config("evm"));
		expect(() => chainConfig()).toThrow("TOKEN2API_MODE does not match");
		expect(() => demoEnabled()).toThrow("TOKEN2API_MODE does not match");
	});

	it("never enables demo identities on remote networks even when ALLOW_DEMO is true", () => {
		vi.stubEnv("ALLOW_DEMO", "true");
		vi.stubEnv("TOKEN2API_MODE", "evm");
		vi.stubEnv("CHAIN_CONFIG_JSON", config("evm"));
		expect(demoEnabled()).toBe(false);
	});
});

it("requires explicit native token metadata without reinterpreting old configs", () => {
	vi.stubEnv("TOKEN2API_MODE", "evm");
	const {
		asset: _asset,
		tokenDecimals: _decimals,
		...original
	} = JSON.parse(config("evm"));
	vi.stubEnv("CHAIN_CONFIG_JSON", JSON.stringify(original));
	expect(() => chainConfig()).toThrow();
	vi.stubEnv(
		"CHAIN_CONFIG_JSON",
		JSON.stringify({ ...original, asset: "ETH" }),
	);
	expect(() => chainConfig()).toThrow("zero token address");
	vi.stubEnv(
		"CHAIN_CONFIG_JSON",
		JSON.stringify({
			...original,
			asset: "ETH",
			token: "0x0000000000000000000000000000000000000000",
		}),
	);
	expect(chainConfig().asset).toBe("ETH");
});

describe("persistent settlement binding", () => {
	it("stores stablecoin precision with the deployment identity", async () => {
		vi.stubEnv("TOKEN2API_MODE", "evm");
		const configured = {
			...JSON.parse(config("evm")),
			chainId: 56,
			asset: "USDT",
			tokenDecimals: 18,
		};
		vi.stubEnv("CHAIN_CONFIG_JSON", JSON.stringify(configured));
		bindingStore.upsert.mockResolvedValue({
			...configured,
			escrow: configured.escrow.toLowerCase(),
			token: configured.token.toLowerCase(),
		});
		await ensureChainBinding();
		expect(bindingStore.upsert).toHaveBeenLastCalledWith(
			expect.objectContaining({
				update: {},
				create: expect.objectContaining({
					chainId: 56,
					asset: "USDT",
					tokenDecimals: 18,
				}),
			}),
		);
	});
	it("verifies the binding once per process and retries after a failure", async () => {
		vi.stubEnv("TOKEN2API_MODE", "evm");
		const configured = JSON.parse(config("evm"));
		vi.stubEnv("CHAIN_CONFIG_JSON", JSON.stringify(configured));
		bindingStore.upsert.mockReset();
		bindingStore.upsert.mockRejectedValueOnce(new Error("database down"));
		await expect(ensureChainBinding()).rejects.toThrow("database down");
		bindingStore.upsert.mockImplementation(
			async ({ create }: { create: unknown }) => create,
		);
		await Promise.all([ensureChainBinding(), ensureChainBinding()]);
		await ensureChainBinding();
		expect(bindingStore.upsert).toHaveBeenCalledTimes(2);
	});
	it.each(["chainId", "asset", "tokenDecimals", "token", "escrow"])(
		"refuses to reinterpret an existing ledger with different %s",
		async (field) => {
			vi.stubEnv("TOKEN2API_MODE", "evm");
			const configured = {
				...JSON.parse(config("evm")),
				chainId: 56,
				asset: "USDT",
				tokenDecimals: 18,
			};
			vi.stubEnv("CHAIN_CONFIG_JSON", JSON.stringify(configured));
			bindingStore.upsert.mockResolvedValue({
				...configured,
				[field]:
					field === "tokenDecimals" ? 6 : field === "chainId" ? 1 : "different",
			});
			await expect(ensureChainBinding()).rejects.toThrow("Deployment mismatch");
		},
	);
});
