import { z } from "zod";
import { networkMetadata, settlementChain } from "./network";
import {
	decimalsOf,
	isNativeAsset,
	NATIVE_TOKEN,
	SETTLEMENT_ASSETS,
} from "./settlement-asset";
export const chainConfigSchema = z.object({
	mode: z.enum(["local", "evm"]),
	asset: z.enum(SETTLEMENT_ASSETS),
	chainId: z.number().int().positive(),
	tokenDecimals: z.number().int().min(6).max(18).optional(),
	rpcUrl: z.string().url(),
	token: z.string().regex(/^0x[\da-fA-F]{40}$/),
	escrow: z.string().regex(/^0x[\da-fA-F]{40}$/),
	deploymentBlock: z.string().regex(/^\d+$/),
});
export type ChainConfig = z.infer<typeof chainConfigSchema>;

export function validateChainConfig(value: ChainConfig): ChainConfig {
	if (
		value.mode === "local" &&
		(value.chainId !== 31337 ||
			!["127.0.0.1", "localhost"].includes(new URL(value.rpcUrl).hostname))
	)
		throw new Error("Local chain configuration must use loopback chain 31337.");
	const rpc = new URL(value.rpcUrl);
	if (
		rpc.username ||
		rpc.password ||
		(value.mode === "evm" && rpc.protocol !== "https:") ||
		(value.mode === "local" && rpc.protocol !== "http:")
	)
		throw new Error("Invalid settlement RPC URL.");
	if (value.mode === "evm") settlementChain(value.chainId);
	if (
		isNativeAsset(value.asset) &&
		value.asset !== networkMetadata(value).nativeSymbol
	)
		throw new Error("Settlement native asset does not match the chain.");
	if (isNativeAsset(value.asset) && decimalsOf(value) !== 18)
		throw new Error("Native settlement requires 18 decimals.");
	if (
		["USDT", "USDC"].includes(value.asset) &&
		value.tokenDecimals === undefined
	)
		throw new Error("Stablecoin tokenDecimals must be explicitly configured.");
	if (
		isNativeAsset(value.asset) !==
		(value.token.toLowerCase() === NATIVE_TOKEN)
	)
		throw new Error(
			"Native assets require the zero token address; stablecoins require an ERC20 address.",
		);

	return value;
}
