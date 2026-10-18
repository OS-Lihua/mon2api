/** Ledger amounts are integer millionths of the deployment's settlement asset. */
export const SETTLEMENT_ASSETS = [
	"ETH",
	"BNB",
	"POL",
	"AVAX",
	"USDT",
	"USDC",
	"dUSD",
] as const;
export type SettlementAsset = (typeof SETTLEMENT_ASSETS)[number];
export type BillingUnit = `micro_${SettlementAsset}`;
export type BalanceUnit = "wei" | "atomic" | "micro_dUSD";
export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";
export const isNativeAsset = (asset: SettlementAsset) =>
	!["USDT", "USDC", "dUSD"].includes(asset);
export const assetOf = (config: { asset?: SettlementAsset }): SettlementAsset =>
	config.asset ?? "dUSD";
export const billingUnit = (asset: SettlementAsset): BillingUnit =>
	`micro_${asset}`;
export const balanceUnit = (asset: SettlementAsset): BalanceUnit =>
	isNativeAsset(asset) ? "wei" : asset === "dUSD" ? "micro_dUSD" : "atomic";
export const decimalsOf = (config: {
	asset?: SettlementAsset;
	tokenDecimals?: number;
}) => config.tokenDecimals ?? (isNativeAsset(assetOf(config)) ? 18 : 6);
function scaleOf(asset: SettlementAsset, decimals?: number) {
	const precision = decimals ?? (isNativeAsset(asset) ? 18 : 6);
	if (!Number.isInteger(precision) || precision < 6 || precision > 18)
		throw new Error("Settlement decimals must be between 6 and 18.");
	return 10n ** BigInt(precision - 6);
}
export function toChainAmount(
	amount: number,
	asset: SettlementAsset,
	decimals?: number,
): bigint {
	if (!Number.isSafeInteger(amount) || amount < 0)
		throw new Error("Billing amount must be a nonnegative safe integer.");
	return BigInt(amount) * scaleOf(asset, decimals);
}
export function fromChainAmount(
	amount: bigint,
	asset: SettlementAsset,
	decimals?: number,
): number {
	const scale = scaleOf(asset, decimals);
	if (amount < 0n || amount % scale !== 0n || amount / scale > 2_147_483_647n)
		throw new Error(
			"Chain amount is outside the supported billing precision/range.",
		);
	return Number(amount / scale);
}
