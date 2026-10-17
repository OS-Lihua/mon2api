import "server-only";
import {
	type Address,
	createPublicClient,
	createWalletClient,
	defineChain,
	getAddress,
	type Hex,
	http,
	parseEventLogs,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { escrowAbi, nativeEscrowAbi, tokenAbi } from "~/lib/abi";
import { db } from "~/server/db";
import {
	assetOf,
	fromChainAmount,
	toChainAmount,
} from "~/shared/settlement-asset";
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
export async function readSession(id: string, blockNumber?: bigint) {
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
		blockNumber,
	});
	return {
		consumer,
		provider,
		termsHash,
		budget: fromChainAmount(budget, assetOf(config)),
		spent: fromChainAmount(spent, assetOf(config)),
		nonce: Number(nonce),
		expiresAt: Number(expiresAt),
		closeAfter: Number(closeAfter),
		closed,
	};
}
/** Recover and verify a canonical session-opening receipt before activating a lease. */
export async function findSessionOpen(id: string, hash?: Hex) {
	const { config, publicClient } = clients();
	const escrow = getAddress(config.escrow);
	if (!hash) {
		const logs = await publicClient.getContractEvents({
			address: escrow,
			abi: escrowAbi,
			eventName: "SessionOpened",
			args: { id: id as Hex },
			fromBlock: BigInt(config.deploymentBlock),
			toBlock: "latest",
			strict: true,
		});
		hash = logs.find((log) => !log.removed)?.transactionHash;
	}
	if (!hash) return null;
	const waited = await publicClient.waitForTransactionReceipt({
		hash,
		confirmations: config.mode === "local" ? 1 : 6,
	});
	const receipt = await publicClient.getTransactionReceipt({
		hash: waited.transactionHash,
	});
	const [block, tip] = await Promise.all([
		publicClient.getBlock({ blockNumber: receipt.blockNumber }),
		publicClient.getBlockNumber(),
	]);
	if (
		block.hash !== receipt.blockHash ||
		tip - receipt.blockNumber < (config.mode === "local" ? 0n : 5n)
	)
		return null;
	const event = parseEventLogs({
		abi: escrowAbi,
		eventName: "SessionOpened",
		logs: receipt.logs,
		strict: true,
	}).find(
		(log) =>
			log.address.toLowerCase() === escrow.toLowerCase() &&
			log.args.id.toLowerCase() === id.toLowerCase(),
	);
	if (receipt.status !== "success" || !event) return null;
	return { receipt, event };
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
		assetOf(config) === "MON"
			? publicClient.getBalance({ address: owner })
			: publicClient.readContract({
					address: getAddress(config.token),
					abi: tokenAbi,
					functionName: "balanceOf",
					args: [owner],
				}),
	]);
	return {
		claimable: claimable.toString(),
		walletBalance: walletBalance.toString(),
	};
}
export async function sendSettlement(
	id: string,
	cumulative: number,
	nonce: number,
	receiptsHash: string,
) {
	return serializedChain(async () => {
		const { config } = clients();
		const current = await readSession(id);
		if (current.nonce > nonce) {
			const recovered = await findSettlement(
				id,
				nonce,
				receiptsHash,
				cumulative,
			);
			if (recovered && current.spent >= cumulative) return recovered;
			throw new Error("Settlement receipt does not match chain state.");
		}
		const hash = await meterWallet().writeContract({
			address: getAddress(config.escrow),
			abi: escrowAbi,
			functionName: "settle",
			args: [
				id as Hex,
				toChainAmount(cumulative, assetOf(config)),
				BigInt(nonce),
				receiptsHash as Hex,
			],
		});
		return confirmSettlement(hash, id, nonce, receiptsHash, cumulative);
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
		if (assetOf(config) !== "MON") {
			const approve = await wallet.writeContract({
				address: getAddress(config.token),
				abi: tokenAbi,
				functionName: "approve",
				args: [getAddress(config.escrow), BigInt(args.budget)],
			});
			await publicClient.waitForTransactionReceipt({ hash: approve });
		}
		const argsOnChain = [
			args.id as Hex,
			getAddress(args.provider),
			args.termsHash as Hex,
			toChainAmount(args.budget, assetOf(config)),
			BigInt(args.expiresAt),
		] as const;
		const hash =
			assetOf(config) === "MON"
				? await wallet.writeContract({
						address: getAddress(config.escrow),
						abi: nativeEscrowAbi,
						functionName: "openSession",
						args: argsOnChain,
						value: toChainAmount(args.budget, "MON"),
					})
				: await wallet.writeContract({
						address: getAddress(config.escrow),
						abi: escrowAbi,
						functionName: "openSession",
						args: argsOnChain,
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
/** Validate the canonical receipt as well as every field of the committed bill. */
export async function confirmSettlement(
	hash: Hex,
	id: string,
	nonce: number,
	receiptsHash: string,
	cumulative: number,
): Promise<Hex> {
	const { config, publicClient } = clients();
	const receipt = await publicClient.waitForTransactionReceipt({
		hash,
		confirmations: config.mode === "local" ? 1 : 6,
	});
	if (receipt.status !== "success") throw new Error("Settlement reverted.");
	const events = parseEventLogs({
		abi: escrowAbi,
		eventName: "UsageSettled",
		logs: receipt.logs,
		strict: true,
	}).filter(
		(event) => event.address.toLowerCase() === config.escrow.toLowerCase(),
	);
	if (
		!events.some(
			(event) =>
				event.args.id.toLowerCase() === id.toLowerCase() &&
				event.args.nonce === BigInt(nonce) &&
				event.args.receiptsHash.toLowerCase() === receiptsHash.toLowerCase() &&
				event.args.cumulativeSpent ===
					toChainAmount(cumulative, assetOf(config)),
		)
	)
		throw new Error("Settlement receipt does not match the committed bill.");
	return receipt.transactionHash;
}

/** A closed latest state is provisional until its close event is confirmed. */
export async function findSessionClose(id: string) {
	const { config, publicClient } = clients();
	const logs = await publicClient.getContractEvents({
		address: getAddress(config.escrow),
		abi: escrowAbi,
		eventName: "SessionClosed",
		args: { id: id as Hex },
		fromBlock: BigInt(config.deploymentBlock),
		toBlock: "latest",
		strict: true,
	});
	const hash = logs.find((log) => !log.removed)?.transactionHash;
	if (!hash) throw new Error("Closed session receipt not found.");
	const receipt = await publicClient.waitForTransactionReceipt({
		hash,
		confirmations: config.mode === "local" ? 1 : 6,
	});
	const events = parseEventLogs({
		abi: escrowAbi,
		eventName: "SessionClosed",
		logs: receipt.logs,
		strict: true,
	});
	const event = events.find(
		(log) =>
			log.address.toLowerCase() === config.escrow.toLowerCase() &&
			log.args.id.toLowerCase() === id.toLowerCase(),
	);
	if (receipt.status !== "success" || !event)
		throw new Error("Closed session receipt does not match.");
	const state = await readSession(id, receipt.blockNumber);
	if (
		!state.closed ||
		event.args.refund !==
			toChainAmount(state.budget - state.spent, assetOf(config))
	)
		throw new Error("Closed session state does not match its receipt.");
	return { txHash: receipt.transactionHash, state };
}

export async function findSettlement(
	id: string,
	nonce: number,
	receiptsHash: string,
	cumulative: number,
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
	const hash = logs.find(
		(log) =>
			!log.removed &&
			log.args.receiptsHash?.toLowerCase() === receiptsHash.toLowerCase() &&
			log.args.cumulativeSpent === toChainAmount(cumulative, assetOf(config)),
	)?.transactionHash;
	return hash
		? confirmSettlement(hash, id, nonce, receiptsHash, cumulative)
		: null;
}
export type { Address };
