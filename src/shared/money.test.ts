import { describe, expect, it } from "vitest";
import { formatDUSD, parseMicroAmount } from "./money";

describe("dUSD amounts", () => {
	it("parses exact micro units from user input", () => {
		expect(parseMicroAmount("1.000001")).toBe(1_000_001);
		expect(parseMicroAmount("100.000000")).toBe(100_000_000);
		expect(parseMicroAmount("0.01")).toBe(10_000);
	});

	it.each(["1.0000001", "1e2", "-1", "1,000", "", "1.", "9007199255"])(
		"rejects imprecise or invalid input %s",
		(value) => {
			expect(() => parseMicroAmount(value)).toThrow();
		},
	);

	it("shows small charges without rounding them to zero", () => {
		expect(formatDUSD(1)).toBe("$0.000001");
		expect(formatDUSD(10_000)).toBe("$0.01");
		expect(formatDUSD(1_000_001)).toBe("$1.000001");
		expect(formatDUSD(1_000_000, true)).toBe("$1.000000");
	});

	it("keeps large on-chain balances exact", () => {
		expect(formatDUSD("9007199254740993", true)).toBe("$9,007,199,254.740993");
		expect(() => formatDUSD(Number.MAX_SAFE_INTEGER + 1)).toThrow();
	});
});
