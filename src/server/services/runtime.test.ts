import { afterEach, describe, expect, it, vi } from "vitest";
import { chainConfig, demoEnabled, runtimeDirectory } from "./runtime";

vi.mock("~/server/db", () => ({ db: {} }));

const addresses = {
	token: `0x${"11".repeat(20)}`,
	escrow: `0x${"22".repeat(20)}`,
	meter: `0x${"33".repeat(20)}`,
	treasury: `0x${"44".repeat(20)}`,
};

function config(mode: "local" | "monad-testnet") {
	return JSON.stringify({
		mode,
		chainId: mode === "local" ? 31337 : 10143,
		rpcUrl: mode === "local" ? "http://127.0.0.1:8545" : "https://rpc.example",
		...addresses,
		deploymentBlock: "1",
	});
}

afterEach(() => vi.unstubAllEnvs());

describe("demo identity chain boundary", () => {
	it("defaults to Monad testnet and rejects implicit local deployments", () => {
		vi.stubEnv("MON2API_MODE", "");
		vi.stubEnv("MON2API_DATA_DIR", "");
		vi.stubEnv("CHAIN_CONFIG_JSON", config("monad-testnet"));
		expect(chainConfig().chainId).toBe(10143);
		expect(runtimeDirectory()).toMatch(/\.runtime\/monad-testnet$/);
		vi.stubEnv("CHAIN_CONFIG_JSON", config("local"));
		expect(() => chainConfig()).toThrow("MON2API_MODE does not match");
	});
	it("rejects a non-testnet chain ID in testnet mode", () => {
		vi.stubEnv("MON2API_MODE", "monad-testnet");
		vi.stubEnv(
			"CHAIN_CONFIG_JSON",
			config("monad-testnet").replace("10143", "143"),
		);
		expect(() => chainConfig()).toThrow("Only Monad testnet is supported");
	});
	it("enables the public demo only for a matching loopback deployment", () => {
		vi.stubEnv("ALLOW_DEMO", "true");
		vi.stubEnv("MON2API_MODE", "local");
		vi.stubEnv("CHAIN_CONFIG_JSON", config("local"));
		expect(demoEnabled()).toBe(true);
	});

	it("rejects an environment mode that disagrees with the deployed testnet", () => {
		vi.stubEnv("ALLOW_DEMO", "true");
		vi.stubEnv("MON2API_MODE", "local");
		vi.stubEnv("CHAIN_CONFIG_JSON", config("monad-testnet"));
		expect(() => chainConfig()).toThrow("MON2API_MODE does not match");
		expect(() => demoEnabled()).toThrow("MON2API_MODE does not match");
	});

	it("never enables demo identities on testnet even when ALLOW_DEMO is true", () => {
		vi.stubEnv("ALLOW_DEMO", "true");
		vi.stubEnv("MON2API_MODE", "monad-testnet");
		vi.stubEnv("CHAIN_CONFIG_JSON", config("monad-testnet"));
		expect(demoEnabled()).toBe(false);
	});
});

it("requires explicit native MON metadata without reinterpreting old configs", () => {
	vi.stubEnv("MON2API_MODE", "monad-testnet");
	const original = JSON.parse(config("monad-testnet"));
	vi.stubEnv("CHAIN_CONFIG_JSON", JSON.stringify(original));
	expect(chainConfig().asset).toBe("dUSD");
	vi.stubEnv(
		"CHAIN_CONFIG_JSON",
		JSON.stringify({ ...original, asset: "MON" }),
	);
	expect(() => chainConfig()).toThrow("zero token address");
	vi.stubEnv(
		"CHAIN_CONFIG_JSON",
		JSON.stringify({
			...original,
			asset: "MON",
			token: "0x0000000000000000000000000000000000000000",
		}),
	);
	expect(chainConfig().asset).toBe("MON");
});
