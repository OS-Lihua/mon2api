import "dotenv/config";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ganache from "ganache";
import {
	type Abi,
	createPublicClient,
	createWalletClient,
	getAddress,
	type Hex,
	http,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { escrowAbi } from "../src/lib/abi";
import { inspectEscrowOwnerGuard } from "../src/server/services/escrow-version";
import type { ChainConfig } from "../src/server/services/runtime";
import { assetOf, NATIVE_TOKEN } from "../src/shared/settlement-asset";

// Public development mnemonic, identical to the application's demo wallets.
const mnemonic = "test test test test test test test test test test test junk";
const directory = path.resolve(
	(process.env.TOKEN2API_DATA_DIR ?? process.env.MON2API_DATA_DIR) ||
		".runtime",
);
const configFile = path.join(directory, "chain.json");
const rpcUrl = "http://127.0.0.1:8545";
const account = (index: number) =>
	mnemonicToAccount(mnemonic, { addressIndex: index });
const meter = account(4).address;
const treasury = account(5).address;
type Artifact = { abi: Abi; bytecode: Hex };

if ((process.env.TOKEN2API_MODE ?? process.env.MON2API_MODE) !== "local") {
	throw new Error(
		"Local chain requires TOKEN2API_MODE=local. Use deploy:evm for EVM network.",
	);
}
fs.mkdirSync(directory, { recursive: true });
const server = ganache.server({
	chain: { chainId: foundry.id, hardfork: "shanghai" },
	database: { dbPath: path.join(directory, "ganache") },
	wallet: { mnemonic, totalAccounts: 10, defaultBalance: 1000 },
	logging: { quiet: true },
});
let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	await server.close();
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		void stop().catch(() => {
			process.exitCode = 1;
		});
	});
}

async function main() {
	await server.listen(8545, "127.0.0.1");
	const client = createPublicClient({
		chain: foundry,
		transport: http(rpcUrl),
		pollingInterval: 100,
	});
	const wallet = createWalletClient({
		account: account(0),
		chain: foundry,
		transport: http(rpcUrl),
	});
	if ((await client.getChainId()) !== foundry.id)
		throw new Error("Local chain ID mismatch.");

	if (fs.existsSync(configFile)) {
		const existing = JSON.parse(
			fs.readFileSync(configFile, "utf8"),
		) as ChainConfig;
		if (
			existing.mode !== "local" ||
			existing.chainId !== foundry.id ||
			existing.rpcUrl !== rpcUrl
		) {
			throw new Error(
				"Existing chain configuration belongs to another network. Set a separate TOKEN2API_DATA_DIR.",
			);
		}
		const token = getAddress(existing.token);
		const escrow = getAddress(existing.escrow);
		const [tokenCode, escrowCode] = await Promise.all([
			assetOf(existing) === "ETH"
				? Promise.resolve("native")
				: client.getCode({ address: token }),
			client.getCode({ address: escrow }),
		]);
		if (
			!tokenCode ||
			tokenCode === "0x" ||
			!escrowCode ||
			escrowCode === "0x"
		) {
			throw new Error(
				"Saved deployment is missing from the persistent chain; refusing to replace an existing ledger.",
			);
		}
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
			getAddress(existing.meter) !== meter ||
			getAddress(existing.treasury) !== treasury ||
			actualToken !== token ||
			actualMeter !== meter ||
			actualTreasury !== treasury ||
			actualFee !== 500
		) {
			throw new Error(
				"Saved escrow terms do not match the local demo configuration.",
			);
		}
		if (
			(await inspectEscrowOwnerGuard(client, escrow, account(0).address)) ===
			"legacy"
		)
			console.warn(
				"Saved escrow lacks the session owner guard. New sessions are blocked; existing sessions can still settle, close and withdraw. Use a separate TOKEN2API_DATA_DIR and DATABASE_URL for a guarded deployment.",
			);
		console.log(`Reusing local escrow ${escrow}`);
		console.log("TOKEN2API_CHAIN_READY");
		return;
	}

	execFileSync(process.execPath, ["scripts/compile.mjs"], { stdio: "inherit" });
	const artifact = (name: string) =>
		JSON.parse(
			fs.readFileSync(`contracts/artifacts/${name}.json`, "utf8"),
		) as Artifact;
	const escrowReceipt = await client.waitForTransactionReceipt({
		hash: await wallet.deployContract({
			...artifact("NativeUsageEscrow"),
			args: [meter, treasury, 500],
		}),
	});
	if (escrowReceipt.status !== "success" || !escrowReceipt.contractAddress)
		throw new Error("Native token escrow deployment failed.");
	const token = NATIVE_TOKEN;
	const config: ChainConfig = {
		mode: "local",
		asset: "ETH",
		chainId: foundry.id,
		rpcUrl,
		token,
		escrow: escrowReceipt.contractAddress,
		meter,
		treasury,
		deploymentBlock: escrowReceipt.blockNumber.toString(),
	};
	fs.writeFileSync(`${configFile}.tmp`, `${JSON.stringify(config, null, 2)}\n`);
	fs.renameSync(`${configFile}.tmp`, configFile);
	console.log(`Local native token; escrow ${config.escrow}`);
	console.log("TOKEN2API_CHAIN_READY");
}

main().catch(async (error: unknown) => {
	console.error(error instanceof Error ? error.message : "Local chain failed.");
	process.exitCode = 1;
	await stop();
});
