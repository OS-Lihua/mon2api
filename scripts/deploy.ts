import "dotenv/config";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
	type Abi,
	createPublicClient,
	createWalletClient,
	getAddress,
	type Hex,
	http,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { escrowAbi, tokenAbi } from "../src/lib/abi";
import { assertEscrowOwnerGuard } from "../src/server/services/escrow-version";
import { settlementChain } from "../src/shared/network";
import {
	decimalsOf,
	isNativeAsset,
	NATIVE_TOKEN,
	SETTLEMENT_ASSETS,
} from "../src/shared/settlement-asset";
import {
	chainConfigSchema,
	validateChainConfig,
} from "../src/shared/settlement-config";

function requiredKey(name: "DEPLOYER_PRIVATE_KEY" | "METER_PRIVATE_KEY"): Hex {
	const value = process.env[name];
	if (!value || !/^0x[\da-fA-F]{64}$/.test(value) || !value.startsWith("0x"))
		throw new Error(`${name} must be explicitly configured.`);
	// startsWith is not a template-literal type guard; validate with Zod's typed predicate.
	return z
		.custom<Hex>(
			(input) => typeof input === "string" && /^0x[\da-fA-F]{64}$/.test(input),
		)
		.parse(value);
}
async function main() {
	const chain = settlementChain(
		z.coerce.number().int().positive().parse(process.env.SETTLEMENT_CHAIN_ID),
	);
	const asset = z
		.enum(SETTLEMENT_ASSETS)
		.refine(
			(value) => value !== "dUSD",
			"New deployments require a native asset, USDT or USDC.",
		)
		.parse(process.env.SETTLEMENT_ASSET);
	const rpcUrl = z
		.string()
		.url()
		.parse(process.env.EVM_RPC_URL || chain.rpcUrls.default.http[0]);
	if (new URL(rpcUrl).protocol !== "https:")
		throw new Error("Remote deployment RPC must use HTTPS.");
	const token = isNativeAsset(asset)
		? NATIVE_TOKEN
		: getAddress(
				z
					.string()
					.regex(/^0x[\da-fA-F]{40}$/)
					.parse(process.env.SETTLEMENT_TOKEN_ADDRESS),
			);
	if (!isNativeAsset(asset) && token === NATIVE_TOKEN)
		throw new Error("Stablecoins require a nonzero ERC20 contract address.");
	if (isNativeAsset(asset) && asset !== chain.nativeCurrency.symbol)
		throw new Error("Native asset does not match the selected chain.");
	const directory = path.resolve(
		(process.env.TOKEN2API_DATA_DIR ?? process.env.MON2API_DATA_DIR) ||
			`.runtime/evm/${chain.id}-${asset.toLowerCase()}`,
	);
	const configFile = path.join(directory, "chain.json");
	const deployer = privateKeyToAccount(requiredKey("DEPLOYER_PRIVATE_KEY"));
	const meter = privateKeyToAccount(requiredKey("METER_PRIVATE_KEY")).address;
	for (let index = 0; index < 10; index++) {
		const demo = mnemonicToAccount(
			"test test test test test test test test test test test junk",
			{ addressIndex: index },
		).address;
		if ([deployer.address, meter].includes(demo))
			throw new Error(
				"Public demo accounts are restricted to loopback chain 31337.",
			);
	}
	const treasury = getAddress(
		z
			.string()
			.regex(/^0x[\da-fA-F]{40}$/)
			.parse(process.env.TREASURY_ADDRESS),
	);
	if (treasury === NATIVE_TOKEN)
		throw new Error("TREASURY_ADDRESS cannot be zero.");
	const client = createPublicClient({ chain, transport: http(rpcUrl) });
	if ((await client.getChainId()) !== chain.id)
		throw new Error("RPC chain ID does not match the requested deployment.");
	const tokenDecimals = isNativeAsset(asset)
		? 18
		: await client.readContract({
				address: token,
				abi: tokenAbi,
				functionName: "decimals",
			});
	if (tokenDecimals < 6 || tokenDecimals > 18)
		throw new Error("Unsupported token precision.");
	if (!isNativeAsset(asset)) {
		const code = await client.getCode({ address: token });
		if (!code || code === "0x")
			throw new Error("Settlement token is not a contract.");
	}
	if (fs.existsSync(configFile)) {
		const existing = validateChainConfig(
			chainConfigSchema.parse(JSON.parse(fs.readFileSync(configFile, "utf8"))),
		);
		if (
			existing.mode !== "evm" ||
			existing.chainId !== chain.id ||
			existing.asset !== asset ||
			decimalsOf(existing) !== tokenDecimals ||
			getAddress(existing.token) !== token ||
			getAddress(existing.meter) !== meter ||
			getAddress(existing.treasury) !== treasury
		)
			throw new Error(
				"Existing deployment differs. Use a separate TOKEN2API_DATA_DIR and DATABASE_URL.",
			);
		const escrow = getAddress(existing.escrow);
		const code = await client.getCode({ address: escrow });
		if (!code || code === "0x")
			throw new Error(
				"Saved escrow is absent; refusing to replace the existing ledger.",
			);
		const [actualToken, actualMeter, actualTreasury, fee] = await Promise.all([
			client.readContract({
				address: escrow,
				abi: escrowAbi,
				functionName: "token",
			}),
			client.readContract({
				address: escrow,
				abi: escrowAbi,
				functionName: "meter",
			}),
			client.readContract({
				address: escrow,
				abi: escrowAbi,
				functionName: "treasury",
			}),
			client.readContract({
				address: escrow,
				abi: escrowAbi,
				functionName: "feeBps",
			}),
		]);
		if (
			getAddress(actualToken) !== token ||
			getAddress(actualMeter) !== meter ||
			getAddress(actualTreasury) !== treasury ||
			fee !== 500
		)
			throw new Error("Saved escrow terms differ from the configuration.");
		await assertEscrowOwnerGuard(client, escrow, deployer.address);
		console.log(
			`Reusing ${chain.name} ${asset} escrow ${escrow}; no transactions sent.`,
		);
		return;
	}
	execFileSync(process.execPath, ["scripts/compile.mjs"], { stdio: "inherit" });
	const artifact = z
		.object({
			abi: z.custom<Abi>(
				(value) =>
					Array.isArray(value) &&
					value.every(
						(item: unknown) =>
							typeof item === "object" && item !== null && "type" in item,
					),
			),
			bytecode: z.custom<Hex>(
				(value) => typeof value === "string" && /^0x[\da-fA-F]+$/.test(value),
			),
		})
		.parse(
			JSON.parse(
				fs.readFileSync(
					`contracts/artifacts/${isNativeAsset(asset) ? "NativeUsageEscrow" : "UsageEscrow"}.json`,
					"utf8",
				),
			),
		);
	const wallet = createWalletClient({
		account: deployer,
		chain,
		transport: http(rpcUrl),
	});
	const receipt = await client.waitForTransactionReceipt({
		hash: await wallet.deployContract({
			...artifact,
			args: isNativeAsset(asset)
				? [meter, treasury, 500]
				: [token, meter, treasury, 500],
		}),
		confirmations: 6,
	});
	if (receipt.status !== "success" || !receipt.contractAddress)
		throw new Error("Escrow deployment failed.");
	const config = validateChainConfig(
		chainConfigSchema.parse({
			mode: "evm",
			asset,
			tokenDecimals,
			chainId: chain.id,
			rpcUrl,
			token,
			escrow: receipt.contractAddress,
			meter,
			treasury,
			deploymentBlock: receipt.blockNumber.toString(),
		}),
	);
	fs.mkdirSync(directory, { recursive: true });
	fs.writeFileSync(
		`${configFile}.tmp`,
		`${JSON.stringify(config, null, 2)}\n`,
		{ flag: "wx" },
	);
	fs.renameSync(`${configFile}.tmp`, configFile);
	console.log(
		`${chain.name} ${asset} deployment saved to ${configFile}. Set TOKEN2API_DATA_DIR to this directory before starting the app.`,
	);
}
main().catch((error: unknown) => {
	console.error(
		error instanceof Error ? error.message : "EVM deployment failed.",
	);
	process.exitCode = 1;
});
