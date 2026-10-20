import type { Chain } from "viem";
import {
	arbitrum,
	avalanche,
	base,
	bsc,
	mainnet,
	optimism,
	polygon,
} from "viem/chains";

const robinhood = {
	id: 4663,
	name: "Robinhood Chain",
	nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
	rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
	blockExplorers: {
		default: {
			name: "Blockscout",
			url: "https://robinhoodchain.blockscout.com",
		},
	},
} as const satisfies Chain;

/** Supported settlement networks. BSC is BNB Smart Chain. */
export const SETTLEMENT_CHAINS = [
	mainnet,
	base,
	arbitrum,
	optimism,
	bsc,
	polygon,
	avalanche,
	robinhood,
] as const;
export function settlementChain(chainId: number) {
	const chain = SETTLEMENT_CHAINS.find((candidate) => candidate.id === chainId);
	if (!chain) throw new Error("Unsupported settlement chain.");
	return chain;
}
export const DEFAULT_NETWORK = {
	mode: "evm",
	name: base.name,
	chainId: base.id,
	rpcUrl: base.rpcUrls.default.http[0],
	explorer: base.blockExplorers.default.url,
	asset: "USDC",
	// Circle-issued Base USDC: developers.circle.com/stablecoins/usdc-contract-addresses
	token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
	tokenDecimals: 6,
} as const;

export function networkMetadata(config: {
	mode: "local" | "evm";
	chainId: number;
}) {
	if (config.mode === "local")
		return {
			name: "Local EVM",
			rpcUrl: "http://127.0.0.1:8545",
			explorer: "",
			nativeSymbol: "ETH",
			nativeName: "Ether",
		};
	const chain = settlementChain(config.chainId);
	return {
		name: chain.name,
		rpcUrl: chain.rpcUrls.default.http[0],
		explorer: chain.blockExplorers.default.url,
		nativeSymbol: chain.nativeCurrency.symbol,
		nativeName: chain.nativeCurrency.name,
	};
}
