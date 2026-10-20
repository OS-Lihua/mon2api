import "server-only";

/** JSON amounts stay exact numbers; storage and internal totals use integer micro-units. */
export function ledgerAmount(value: bigint): number {
	if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
		throw new Error("Ledger amount is outside the exact JSON integer range.");
	return Number(value);
}
