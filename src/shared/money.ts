import { formatUnits, parseUnits } from "viem";
import { decimalsOf, type SettlementAsset } from "./settlement-asset";

const MICRO_DECIMALS = 6;

/** Parse a settlement amount without rounding fractional micro-units. */
export function parseMicroAmount(value: string): number {
	if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value))
		throw new Error("金额最多只能输入 6 位小数，且不能使用科学计数法。");
	const amount = parseUnits(value, MICRO_DECIMALS);
	if (amount > BigInt(Number.MAX_SAFE_INTEGER))
		throw new Error("金额超出允许范围。");
	return Number(amount);
}

/** Format integer micro-units, including balances beyond JS's safe integer range. */
export function formatAmount(amount: number | string, precise = false): string {
	if (typeof amount === "number" && !Number.isSafeInteger(amount))
		throw new Error("金额必须是安全整数。");
	const [whole, fraction = ""] = formatUnits(
		BigInt(amount),
		MICRO_DECIMALS,
	).split(".");
	const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	const digits = precise ? fraction.padEnd(6, "0") : fraction.padEnd(2, "0");
	return `${grouped}.${digits}`;
}
export function formatChainBalance(
	amount: string,
	asset: SettlementAsset,
	tokenDecimals?: number,
): string {
	if (!/^\d+$/.test(amount)) throw new Error("余额必须是非负整数。");
	return formatUnits(BigInt(amount), decimalsOf({ asset, tokenDecimals }));
}
