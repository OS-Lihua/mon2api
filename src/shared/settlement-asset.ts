/** Billing amounts are bounded integer micro-units; native transfers use wei. */
export type SettlementAsset = "MON" | "dUSD";
export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";
export const WEI_PER_MICROMON = 1_000_000_000_000n;
export const assetOf = (config: { asset?: SettlementAsset }): SettlementAsset =>
	config.asset ?? "dUSD";
export const billingUnit = (asset: SettlementAsset) =>
	asset === "MON" ? ("micro_MON" as const) : ("micro_dUSD" as const);
export function toChainAmount(amount: number, asset: SettlementAsset): bigint {
	if (!Number.isSafeInteger(amount) || amount < 0)
		throw new Error("Billing amount must be a nonnegative safe integer.");
	return BigInt(amount) * (asset === "MON" ? WEI_PER_MICROMON : 1n);
}
export function fromChainAmount(
	amount: bigint,
	asset: SettlementAsset,
): number {
	const scale = asset === "MON" ? WEI_PER_MICROMON : 1n;
	if (amount < 0n || amount % scale !== 0n || amount / scale > 2_147_483_647n)
		throw new Error(
			"Chain amount is outside the supported billing precision/range.",
		);
	return Number(amount / scale);
}
