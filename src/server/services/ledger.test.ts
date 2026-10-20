import { describe, expect, it } from "vitest";
import { ledgerAmount } from "./ledger";

describe("exact ledger serialization", () => {
	it.each([0n, 1n, 5_000_000_000n, BigInt(Number.MAX_SAFE_INTEGER)])(
		"serializes %s micro-units exactly across the bigint/JSON boundary",
		(value) => {
			const number = ledgerAmount(value);
			expect(BigInt(number)).toBe(value);
			expect(JSON.parse(JSON.stringify({ amount: number })).amount).toBe(
				number,
			);
		},
	);
	it.each([-1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n])(
		"rejects %s rather than rounding or exposing a negative amount",
		(value) => expect(() => ledgerAmount(value)).toThrow(),
	);
});
