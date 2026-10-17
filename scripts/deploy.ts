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
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { escrowAbi } from "../src/lib/abi";
import { inspectEscrowOwnerGuard } from "../src/server/services/escrow-version";
import type { ChainConfig } from "../src/server/services/runtime";
import { MONAD_TESTNET } from "../src/shared/network";
import { assetOf, NATIVE_TOKEN } from "../src/shared/settlement-asset";

// This script has no mainnet code path. Every transaction is signed for 10143.
const chainId = MONAD_TESTNET.chainId;
const rpcUrl = process.env.MONAD_RPC_URL || MONAD_TESTNET.rpcUrl;
const directory = path.resolve(
	process.env.MON2API_DATA_DIR || ".runtime/monad-testnet",
);
const configFile = path.join(directory, "chain.json");
type Artifact = { abi: Abi; bytecode: Hex };

function requiredKey(name: "DEPLOYER_PRIVATE_KEY" | "METER_PRIVATE_KEY"): Hex {
	const value = process.env[name];
	if (!value || !/^0x[\da-fA-F]{64}$/.test(value))
		throw new Error(`${name} must be explicitly set to a testnet private key.`);
	return value as Hex;
}

async function main() {
	const deployer = privateKeyToAccount(requiredKey("DEPLOYER_PRIVATE_KEY"));
	const meter = privateKeyToAccount(requiredKey("METER_PRIVATE_KEY")).address;
	if (!process.env.TREASURY_ADDRESS)
		throw new Error("TREASURY_ADDRESS must be explicitly set.");
	const treasury = getAddress(process.env.TREASURY_ADDRESS);
	if (treasury === "0x0000000000000000000000000000000000000000")
		throw new Error("TREASURY_ADDRESS cannot be zero.");
	const client = createPublicClient({
		chain: monadTestnet,
		transport: http(rpcUrl),
		pollingInterval: 1000,
	});
	if (monadTestnet.id !== chainId || (await client.getChainId()) !== chainId)
		throw new Error(
			"Refusing deployment: RPC must be Monad testnet, chain 10143.",
		);
	const wallet = createWalletClient({
		account: deployer,
		chain: monadTestnet,
		transport: http(rpcUrl),
	});
	if (fs.existsSync(configFile)) {
		const existing = JSON.parse(
			fs.readFileSync(configFile, "utf8"),
		) as ChainConfig;
		if (
			existing.mode !== "monad-testnet" ||
			existing.chainId !== chainId ||
			getAddress(existing.meter) !== meter ||
			getAddress(existing.treasury) !== treasury
		) {
			throw new Error(
				"Existing deployment uses another network or signer. Use a separate MON2API_DATA_DIR.",
			);
		}
		const token = getAddress(existing.token);
		const escrow = getAddress(existing.escrow);
		const [tokenCode, escrowCode] = await Promise.all([
			assetOf(existing) === "MON"
				? Promise.resolve("native")
				: client.getCode({ address: token }),
			client.getCode({ address: escrow }),
		]);
		if (!tokenCode || tokenCode === "0x" || !escrowCode || escrowCode === "0x")
			throw new Error(
				"Saved contracts are absent; refusing to replace the existing ledger.",
			);
		const [actualToken, actualMeter, actualTreasury, actualFee] =
			await Promise.all([
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
			actualToken !== token ||
			actualMeter !== meter ||
			actualTreasury !== treasury ||
			actualFee !== 500
		) {
			throw new Error(
				"Existing escrow does not match the requested testnet deployment terms.",
			);
		}
		if (
			(await inspectEscrowOwnerGuard(client, escrow, deployer.address)) ===
			"legacy"
		)
			console.warn(
				"Saved escrow lacks the session owner guard. New sessions are blocked; existing sessions can still settle, close and withdraw. Use a separate MON2API_DATA_DIR and DATABASE_URL for a guarded deployment.",
			);
		console.log(
			`Reusing Monad testnet escrow ${escrow}; no transactions sent.`,
		);
		return;
	}

	execFileSync(process.execPath, ["scripts/compile.mjs"], { stdio: "inherit" });
	const artifact = (name: string) =>
		JSON.parse(
			fs.readFileSync(`contracts/artifacts/${name}.json`, "utf8"),
		) as Artifact;
	const token = NATIVE_TOKEN;
	const receipt = await client.waitForTransactionReceipt({
		hash: await wallet.deployContract({
			...artifact("NativeUsageEscrow"),
			args: [meter, treasury, 500],
		}),
		confirmations: 2,
	});
	if (receipt.status !== "success" || !receipt.contractAddress)
		throw new Error("Escrow deployment failed.");
	const config: ChainConfig = {
		mode: "monad-testnet",
		asset: "MON",
		chainId,
		rpcUrl,
		token,
		escrow: receipt.contractAddress,
		meter,
		treasury,
		deploymentBlock: receipt.blockNumber.toString(),
	};
	fs.mkdirSync(directory, { recursive: true });
	fs.writeFileSync(`${configFile}.tmp`, `${JSON.stringify(config, null, 2)}\n`);
	fs.renameSync(`${configFile}.tmp`, configFile);
	console.log(`Monad testnet deployment saved to ${configFile}`);
	console.log(`Native MON (wei); escrow ${config.escrow}`);
}

main().catch((error: unknown) => {
	console.error(
		error instanceof Error ? error.message : "Monad testnet deployment failed.",
	);
	process.exitCode = 1;
});
