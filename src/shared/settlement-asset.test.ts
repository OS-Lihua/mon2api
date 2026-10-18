import { describe, expect, it } from "vitest";
import { formatAmount, formatChainBalance, parseMicroAmount } from "./money";
import { assetOf, fromChainAmount, toChainAmount } from "./settlement-asset";

describe("Native asset denomination boundaries", () => {
	it("converts large wei amounts exactly without a floating-point intermediate", () => {
		expect(toChainAmount(100_000_000, "ETH")).toBe(
			100_000_000_000_000_000_000n,
		);
		expect(fromChainAmount(100_000_000_000_000_000_000n, "ETH")).toBe(
			100_000_000,
		);
		expect(formatChainBalance("100000000000000000001", "ETH")).toBe(
			"100.000000000000000001",
		);
		expect(parseMicroAmount("1.000001")).toBe(1_000_001);
		expect(formatAmount(1)).toBe("0.000001");
	});
	it("refuses fractional billing units, database overflow and unsafe numbers", () => {
		expect(() => fromChainAmount(1n, "ETH")).toThrow();
		expect(() => fromChainAmount(2_147_483_648n * 10n ** 12n, "ETH")).toThrow();
		expect(() => toChainAmount(Number.MAX_SAFE_INTEGER + 1, "ETH")).toThrow();
		expect(() => parseMicroAmount("0.0000001")).toThrow();
	});
	it("keeps old deployments denominated in micro dUSD", () => {
		expect(assetOf({})).toBe("dUSD");
		expect(toChainAmount(1_000_000, "dUSD")).toBe(1_000_000n);
		expect(fromChainAmount(1_000_000n, "dUSD")).toBe(1_000_000);
	});
});

describe("stablecoin precision", () => {
	it.each(["USDT", "USDC"] as const)(
		"converts %s at 6 and 18 decimals exactly",
		(asset) => {
			for (const decimals of [6, 18]) {
				const amount = toChainAmount(1_234_567, asset, decimals);
				expect(amount).toBe(1_234_567n * 10n ** BigInt(decimals - 6));
				expect(fromChainAmount(amount, asset, decimals)).toBe(1_234_567);
				expect(formatChainBalance(amount.toString(), asset, decimals)).toBe(
					"1.234567",
				);
			}
		},
	);
	it("rejects unsupported precision and fractional micro-unit settlement", () => {
		expect(() => toChainAmount(1, "USDT", 5)).toThrow("decimals");
		expect(() => toChainAmount(1, "USDC", 19)).toThrow("decimals");
		expect(() => fromChainAmount(1n, "USDT", 18)).toThrow("precision");
	});
});
