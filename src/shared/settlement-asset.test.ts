import { describe, expect, it } from "vitest";
import { formatChainBalance, formatMON, parseMicroMON } from "./money";
import { assetOf, fromChainAmount, toChainAmount } from "./settlement-asset";

describe("MON denomination boundaries", () => {
	it("converts large wei amounts exactly without a floating-point intermediate", () => {
		expect(toChainAmount(100_000_000, "MON")).toBe(
			100_000_000_000_000_000_000n,
		);
		expect(fromChainAmount(100_000_000_000_000_000_000n, "MON")).toBe(
			100_000_000,
		);
		expect(formatChainBalance("100000000000000000001", "MON")).toBe(
			"100.000000000000000001",
		);
		expect(parseMicroMON("1.000001")).toBe(1_000_001);
		expect(formatMON(1)).toBe("0.000001");
	});
	it("refuses fractional billing units, database overflow and unsafe numbers", () => {
		expect(() => fromChainAmount(1n, "MON")).toThrow();
		expect(() => fromChainAmount(2_147_483_648n * 10n ** 12n, "MON")).toThrow();
		expect(() => toChainAmount(Number.MAX_SAFE_INTEGER + 1, "MON")).toThrow();
		expect(() => parseMicroMON("0.0000001")).toThrow();
	});
	it("keeps old deployments denominated in micro dUSD", () => {
		expect(assetOf({})).toBe("dUSD");
		expect(toChainAmount(1_000_000, "dUSD")).toBe(1_000_000n);
		expect(fromChainAmount(1_000_000n, "dUSD")).toBe(1_000_000);
	});
});
