import { afterEach, describe, expect, it, vi } from "vitest";
import { chainConfig, demoEnabled } from "./runtime";

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
