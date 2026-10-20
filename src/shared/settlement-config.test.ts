import { describe, expect, it } from "vitest";
import { defineWalletChain } from "~/lib/wallet";
import { DEFAULT_NETWORK, networkMetadata, SETTLEMENT_CHAINS } from "./network";
import {
	billingUnit,
	NATIVE_TOKEN,
	type SettlementAsset,
} from "./settlement-asset";
import { chainConfigSchema, validateChainConfig } from "./settlement-config";
import { previewSnapshot } from "./ui-preview";

const metadata = {
	mode: "evm" as const,
	chainId: 8453,
	asset: "ETH" as const,
	rpcUrl: "https://rpc.example",
	token: NATIVE_TOKEN,
	escrow: `0x${"11".repeat(20)}`,
	deploymentBlock: "1",
};
const parse = (input: unknown) =>
	validateChainConfig(chainConfigSchema.parse(input));

describe("settlement network and asset boundaries", () => {
	it("rejects missing assets and obsolete test assets instead of applying a fallback", () => {
		const { asset: _asset, ...missing } = metadata;
		expect(() => parse(missing)).toThrow();
		expect(() => parse({ ...metadata, asset: "dUSD" })).toThrow();
	});
	it("uses the configured default network consistently for the market and wallet", () => {
		expect(DEFAULT_NETWORK).toMatchObject({ mode: "evm", chainId: 1 });
		expect(previewSnapshot.network).toMatchObject({ chainId: 1, asset: "ETH" });
		const config = parse({ ...metadata, chainId: DEFAULT_NETWORK.chainId });
		const wallet = defineWalletChain({
			...previewSnapshot.network,
			...networkMetadata(config),
		});
		expect(wallet.id).toBe(1);
		expect(wallet.nativeCurrency.symbol).toBe("ETH");
	});
	it.each(["USDT", "USDC"] satisfies SettlementAsset[])(
		"accepts explicitly configured Ethereum mainnet %s with six decimals",
		(asset) => {
			expect(
				parse({
					...metadata,
					chainId: 1,
					asset,
					token: `0x${"44".repeat(20)}`,
					tokenDecimals: 6,
				}),
			).toMatchObject({ chainId: 1, asset, tokenDecimals: 6 });
		},
	);
	it.each(SETTLEMENT_CHAINS)(
		"uses the correct native currency on $name",
		(chain) => {
			const config = parse({
				...metadata,
				chainId: chain.id,
				asset: chain.nativeCurrency.symbol,
			});
			const wallet = defineWalletChain({
				...previewSnapshot.network,
				...networkMetadata(config),
				chainId: chain.id,
				asset: config.asset,
				ledgerUnit: billingUnit(config.asset),
			});
			expect(wallet.id).toBe(chain.id);
			expect(wallet.nativeCurrency).toEqual(chain.nativeCurrency);
		},
	);
	it("includes BSC and Robinhood Chain with their distinct native currencies", () => {
		expect(networkMetadata({ mode: "evm", chainId: 56 }).nativeSymbol).toBe(
			"BNB",
		);
		expect(networkMetadata({ mode: "evm", chainId: 4663 })).toMatchObject({
			nativeSymbol: "ETH",
			rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
			explorer: "https://robinhoodchain.blockscout.com",
		});
	});
	it.each(["USDT", "USDC"] satisfies SettlementAsset[])(
		"requires explicit precision and ERC20 address for %s",
		(asset) => {
			const input = {
				...metadata,
				chainId: 56,
				asset,
				token: `0x${"44".repeat(20)}`,
			};
			expect(() => parse(input)).toThrow("tokenDecimals");
			expect(parse({ ...input, tokenDecimals: 18 })).toMatchObject({
				asset,
				tokenDecimals: 18,
			});
			expect(() =>
				parse({ ...input, tokenDecimals: 6, token: NATIVE_TOKEN }),
			).toThrow("ERC20 address");
		},
	);
	it("rejects a mismatched native symbol or precision", () => {
		expect(() => parse({ ...metadata, chainId: 56 })).toThrow("does not match");
		expect(() => parse({ ...metadata, tokenDecimals: 6 })).toThrow(
			"18 decimals",
		);
	});
	it("rejects unsupported chains and remote demo bypasses", () => {
		expect(() => parse({ ...metadata, chainId: 999 })).toThrow("Unsupported");
		expect(() => parse({ ...metadata, mode: "local" })).toThrow("31337");
		expect(() => parse({ ...metadata, mode: "local", chainId: 31337 })).toThrow(
			"loopback",
		);
		expect(() => parse({ ...metadata, rpcUrl: "http://rpc.example" })).toThrow(
			"RPC URL",
		);
	});
});
