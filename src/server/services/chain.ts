import "server-only";
import {
	type Address,
	createPublicClient,
	createWalletClient,
	defineChain,
	getAddress,
	type Hex,
	http,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { escrowAbi, tokenAbi } from "~/lib/abi";
import { db } from "~/server/db";
import { chainConfig, demoEnabled } from "./runtime";

// Standard public test mnemonic. Never fund these addresses on a real network.
export const DEMO_MNEMONIC =
	"test test test test test test test test test test test junk";
export function demoAccount(index = 0) {
	return mnemonicToAccount(DEMO_MNEMONIC, { addressIndex: index });
}
export function clients() {
	const config = chainConfig();
	const chain = defineChain({
		id: config.chainId,
		name: config.mode === "local" ? "Local EVM" : "Monad Testnet",
		nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
		rpcUrls: { default: { http: [config.rpcUrl] } },
	});
	return {
		config,
		chain,
		publicClient: createPublicClient({ chain, transport: http(config.rpcUrl) }),
	};
}
function meterWallet() {
	const { config, chain } = clients();
	const privateKey = process.env.METER_PRIVATE_KEY;
	if (
		config.mode !== "local" &&
		(!privateKey || !/^0x[\da-fA-F]{64}$/.test(privateKey))
	)
		throw new Error("METER_PRIVATE_KEY is required.");
	const account =
		config.mode === "local"
			? demoAccount(4)
			: privateKeyToAccount(privateKey as Hex);
	if (account.address.toLowerCase() !== config.meter.toLowerCase())
		throw new Error("Meter signer mismatch.");
	return createWalletClient({ account, chain, transport: http(config.rpcUrl) });
}
type ChainGlobal = typeof globalThis & { mon2apiChainQueue?: Promise<unknown> };
export async function serializedChain<T>(action: () => Promise<T>): Promise<T> {
	const global = globalThis as ChainGlobal;
	const previous = global.mon2apiChainQueue || Promise.resolve();
	const result = previous
		.catch(() => undefined)
		.then(() =>
			db.$transaction(
				async (tx) => {
					await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${"mon2api:chain-signer"}))`;
					return action();
				},
				{ timeout: 120_000, maxWait: 30_000 },
			),
		);
	global.mon2apiChainQueue = result.catch(() => undefined);
	return result;
}
export async function readSession(id: string) {
	const { config, publicClient } = clients();
	const [
		consumer,
		provider,
		termsHash,
		budget,
		spent,
		nonce,
		expiresAt,
		closeAfter,
		closed,
	] = await publicClient.readContract({
		address: getAddress(config.escrow),
		abi: escrowAbi,
		functionName: "sessions",
		args: [id as Hex],
	});
	return {
		consumer,
		provider,
		termsHash,
		budget: Number(budget),
		spent: Number(spent),
		nonce: Number(nonce),
		expiresAt: Number(expiresAt),
		closeAfter: Number(closeAfter),
		closed,
	};
}
export async function chainBalances(address: string) {
	const { config, publicClient } = clients();
	const owner = getAddress(address);
	const [claimable, walletBalance] = await Promise.all([
		publicClient.readContract({
			address: getAddress(config.escrow),
			abi: escrowAbi,
			functionName: "claimable",
			args: [owner],
		}),
		publicClient.readContract({
			address: getAddress(config.token),
			abi: tokenAbi,
			functionName: "balanceOf",
			args: [owner],
		}),
	]);
	return { claimable: Number(claimable), walletBalance: Number(walletBalance) };
}
export async function sendSettlement(
	id: string,
	cumulative: number,
	nonce: number,
	receiptsHash: string,
) {
	return serializedChain(async () => {
		const { config, publicClient } = clients();
		const current = await readSession(id);
		if (current.nonce > nonce) {
			const recovered = await findSettlement(id, nonce, receiptsHash);
			if (recovered && current.spent >= cumulative) return recovered;
			throw new Error("Settlement receipt does not match chain state.");
		}
		const hash = await meterWallet().writeContract({
			address: getAddress(config.escrow),
			abi: escrowAbi,
			functionName: "settle",
			args: [id as Hex, BigInt(cumulative), BigInt(nonce), receiptsHash as Hex],
		});
		const receipt = await publicClient.waitForTransactionReceipt({
			hash,
			confirmations: config.mode === "local" ? 1 : 6,
		});
		if (receipt.status !== "success") throw new Error("Settlement reverted.");
		return hash;
	});
}
export async function sendClose(id: string) {
	return serializedChain(async () => {
		const { config, publicClient } = clients();
		if ((await readSession(id)).closed) return null;
		const hash = await meterWallet().writeContract({
			address: getAddress(config.escrow),
			abi: escrowAbi,
			functionName: "closeSession",
			args: [id as Hex],
		});
		const receipt = await publicClient.waitForTransactionReceipt({
			hash,
			confirmations: config.mode === "local" ? 1 : 6,
		});
		if (receipt.status !== "success") throw new Error("Close reverted.");
		return hash;
	});
}
export async function demoOpen(
	address: string,
	args: {
		id: string;
		provider: string;
		termsHash: string;
		budget: number;
		expiresAt: number;
	},
) {
	if (!demoEnabled() || chainConfig().mode !== "local")
		throw new Error("Demo signing is disabled.");
	const account = [demoAccount(0), demoAccount(1)].find(
		(a) => a.address.toLowerCase() === address.toLowerCase(),
	);
	if (!account) throw new Error("Unknown demo wallet.");
	return serializedChain(async () => {
		const { config, chain, publicClient } = clients();
		const wallet = createWalletClient({
			account,
			chain,
			transport: http(config.rpcUrl),
		});
		const approve = await wallet.writeContract({
			address: getAddress(config.token),
			abi: tokenAbi,
			functionName: "approve",
			args: [getAddress(config.escrow), BigInt(args.budget)],
		});
		await publicClient.waitForTransactionReceipt({ hash: approve });
		const hash = await wallet.writeContract({
			address: getAddress(config.escrow),
			abi: escrowAbi,
			functionName: "openSession",
			args: [
				args.id as Hex,
				getAddress(args.provider),
				args.termsHash as Hex,
				BigInt(args.budget),
				BigInt(args.expiresAt),
			],
		});
		await publicClient.waitForTransactionReceipt({
			hash,
			confirmations: config.mode === "local" ? 1 : 6,
		});
		return hash;
	});
}
export async function demoWithdraw(address: string) {
	if (!demoEnabled() || chainConfig().mode !== "local")
		throw new Error("Demo signing is disabled.");
	const account = [demoAccount(0), demoAccount(1)].find(
		(a) => a.address.toLowerCase() === address.toLowerCase(),
	);
	if (!account) throw new Error("Unknown demo wallet.");
	return serializedChain(async () => {
		const { config, chain, publicClient } = clients();
		const hash = await createWalletClient({
			account,
			chain,
			transport: http(config.rpcUrl),
		}).writeContract({
			address: getAddress(config.escrow),
			abi: escrowAbi,
			functionName: "withdraw",
		});
		await publicClient.waitForTransactionReceipt({
			hash,
			confirmations: config.mode === "local" ? 1 : 6,
		});
		return hash;
	});
}
export async function findSettlement(
	id: string,
	nonce: number,
	receiptsHash: string,
): Promise<Hex | null> {
	const { config, publicClient } = clients();
	const logs = await publicClient.getContractEvents({
		address: getAddress(config.escrow),
		abi: escrowAbi,
		eventName: "UsageSettled",
		args: { id: id as Hex, nonce: BigInt(nonce) },
		fromBlock: BigInt(config.deploymentBlock),
		toBlock: "latest",
	});
	return (
		logs.find(
			(l) => l.args.receiptsHash?.toLowerCase() === receiptsHash.toLowerCase(),
		)?.transactionHash || null
	);
}
export type { Address };
