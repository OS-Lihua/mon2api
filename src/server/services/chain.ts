import "server-only";
import type { ChainTransaction, Prisma } from "@prisma/client";
import {
	createPublicClient,
	createWalletClient,
	defineChain,
	encodeFunctionData,
	getAddress,
	type Hex,
	http,
	keccak256,
	parseEventLogs,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { escrowAbi, nativeEscrowAbi, tokenAbi } from "~/lib/abi";
import { db } from "~/server/db";
import { networkMetadata } from "~/shared/network";
import {
	assetOf,
	decimalsOf,
	fromChainAmount,
	isNativeAsset,
	toChainAmount,
} from "~/shared/settlement-asset";
import { chainConfig, demoEnabled } from "./runtime";

// Standard public test mnemonic. Never fund these addresses on a real network.
const DEMO_MNEMONIC =
	"test test test test test test test test test test test junk";
export function demoAccount(index = 0) {
	return mnemonicToAccount(DEMO_MNEMONIC, { addressIndex: index });
}
function createClients(config: ReturnType<typeof chainConfig>) {
	const chain = defineChain({
		id: config.chainId,
		name: networkMetadata(config).name,
		nativeCurrency: {
			name: networkMetadata(config).nativeName,
			symbol: networkMetadata(config).nativeSymbol,
			decimals: 18,
		},
		rpcUrls: { default: { http: [config.rpcUrl] } },
	});
	return {
		chain,
		// A shared client must not serve cached block numbers to receipt checks.
		publicClient: createPublicClient({
			chain,
			cacheTime: 0,
			transport: http(config.rpcUrl),
		}),
	};
}
let clientCache:
	| ({ key: string } & ReturnType<typeof createClients>)
	| undefined;
/** Reuse one RPC client per chain endpoint so connections stay pooled. */
export function clients() {
	const config = chainConfig();
	const key = `${config.mode}:${config.chainId}:${config.rpcUrl}`;
	if (clientCache?.key !== key) clientCache = { key, ...createClients(config) };
	return {
		config,
		chain: clientCache.chain,
		publicClient: clientCache.publicClient,
	};
}

/** Resolve the configured signer against the current on-chain owner, never saved metadata. */
export async function ownerWallet(checkOwner = true) {
	const { config, chain, publicClient } = clients();
	const privateKey = process.env.ESCROW_OWNER_PRIVATE_KEY;
	const account =
		config.mode === "local" && !privateKey
			? demoAccount(4)
			: privateKeyToAccount(
					z
						.custom<Hex>(
							(value) =>
								typeof value === "string" && /^0x[\da-fA-F]{64}$/.test(value),
							"ESCROW_OWNER_PRIVATE_KEY must be configured with a valid signing key.",
						)
						.parse(privateKey),
				);
	if (
		config.mode !== "local" &&
		Array.from(
			{ length: 10 },
			(_, index) => demoAccount(index).address,
		).includes(account.address)
	)
		throw new Error(
			"Public demo accounts are restricted to loopback chain 31337.",
		);
	if (checkOwner) {
		const owner = await publicClient.readContract({
			address: getAddress(config.escrow),
			abi: escrowAbi,
			functionName: "owner",
		});
		if (getAddress(owner) !== account.address)
			throw new Error("Configured signer is not the current escrow owner.");
	}
	return createWalletClient({ account, chain, transport: http(config.rpcUrl) });
}

let pauseState:
	| { key: string; expires: number; value: Promise<boolean> }
	| undefined;
/** Admission reads share a one-second cache; failed reads never admit work. */
export function readEscrowPaused(): Promise<boolean> {
	const { config, publicClient } = clients();
	const key = `${config.chainId}:${config.rpcUrl}:${config.escrow}`;
	if (pauseState?.key === key && pauseState.expires > Date.now())
		return pauseState.value;
	const value = publicClient.readContract({
		address: getAddress(config.escrow),
		abi: escrowAbi,
		functionName: "paused",
	});
	pauseState = { key, expires: Date.now() + 1000, value };
	value.catch(() => {
		if (pauseState?.value === value) pauseState = undefined;
	});
	return value;
}
type ChainGlobal = typeof globalThis & {
	token2apiChainQueue?: Promise<unknown>;
};
async function serializedChain<T>(
	action: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	const global = globalThis as ChainGlobal;
	const previous = global.token2apiChainQueue || Promise.resolve();
	const result = previous
		.catch(() => undefined)
		.then(() =>
			db.$transaction(
				async (tx) => {
					await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${"token2api:chain-signer"}))`;
					return action(tx);
				},
				{ timeout: 120_000, maxWait: 30_000 },
			),
		);
	global.token2apiChainQueue = result.catch(() => undefined);
	return result;
}

const transactionHex = z.custom<Hex>(
	(value) => typeof value === "string" && /^0x(?:[\da-fA-F]{2})+$/.test(value),
	"Invalid stored transaction bytes.",
);
class EscrowTransactionReverted extends Error {}

/** Allocate a nonce and commit the signed bytes before any broadcast. */
async function prepareOwnerTransaction(id: string, data: Hex) {
	return serializedChain(async (tx) => {
		const existing = await tx.chainTransaction.findUnique({ where: { id } });
		if (existing && !["REVERTED", "CONSUMED"].includes(existing.status))
			return existing;
		const { config, publicClient } = clients();
		const wallet = await ownerWallet();
		const sender = wallet.account.address.toLowerCase();
		const [pendingNonce, stored] = await Promise.all([
			publicClient.getTransactionCount({
				address: wallet.account.address,
				blockTag: "pending",
			}),
			tx.chainTransaction.aggregate({
				where: { sender },
				_max: { nonce: true },
			}),
		]);
		// The durable maximum protects concurrent processes against a stale RPC mempool view.
		const nonce = Math.max(pendingNonce, (stored._max.nonce ?? -1) + 1);
		const request = await wallet.prepareTransactionRequest({
			to: getAddress(config.escrow),
			data,
			nonce,
		});
		const raw = await wallet.signTransaction(request);
		const transaction = {
			sender,
			nonce,
			raw,
			hash: keccak256(raw),
			status: "PENDING",
		};
		return tx.chainTransaction.upsert({
			where: { id },
			create: { id, ...transaction },
			update: transaction,
		});
	});
}

/** Replay earlier signed nonces too, including a process crash before broadcast. */
async function broadcastOwnerTransaction(
	transaction: ChainTransaction,
): Promise<Hex> {
	const { config, publicClient } = clients();
	const pending = await db.chainTransaction.findMany({
		where: {
			sender: transaction.sender,
			status: "PENDING",
			nonce: { lte: transaction.nonce },
		},
		orderBy: { nonce: "asc" },
	});
	for (const item of pending) {
		const hash = transactionHex.parse(item.hash);
		try {
			const sent = await publicClient.sendRawTransaction({
				serializedTransaction: transactionHex.parse(item.raw),
			});
			if (sent.toLowerCase() !== hash.toLowerCase())
				throw new Error(
					"Broadcast transaction hash does not match signed bytes.",
				);
		} catch (cause) {
			// An already-known or mined transaction is safe to reuse. Unknown failures stay durable.
			const known = await publicClient
				.getTransaction({ hash })
				.catch(() => null);
			if (!known) {
				// An administrator may have used this nonce while the worker was stopped.
				// Only a confirmed account nonce can retire the saved transaction.
				const tip = await publicClient.getBlockNumber();
				const depth = config.mode === "local" ? 0n : 5n;
				const consumed =
					tip >= depth &&
					(await publicClient.getTransactionCount({
						address: getAddress(item.sender),
						blockNumber: tip - depth,
					})) > item.nonce;
				if (!consumed) throw cause;
				await recordOwnerTransaction(hash, "CONSUMED");
				if (item.id === transaction.id)
					throw new Error(
						"Saved transaction nonce was consumed; retry to prepare a new transaction.",
					);
			}
		}
	}
	return transactionHex.parse(transaction.hash);
}

async function recordOwnerTransaction(
	hash: Hex,
	status: "CONFIRMED" | "REVERTED" | "CONSUMED",
) {
	await db.chainTransaction.updateMany({
		where: { hash, status: "PENDING" },
		data: { status },
	});
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
		budget: fromChainAmount(budget, assetOf(config), decimalsOf(config)),
		spent: fromChainAmount(spent, assetOf(config), decimalsOf(config)),
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
		isNativeAsset(assetOf(config))
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
	const { config } = clients();
	const current = await readSession(id);
	if (current.nonce > nonce) {
		const recovered = await findSettlement(id, nonce, receiptsHash, cumulative);
		if (recovered && current.spent >= cumulative) {
			await recordOwnerTransaction(recovered, "CONFIRMED");
			return recovered;
		}
		throw new Error("Settlement receipt does not match chain state.");
	}
	const transaction = await prepareOwnerTransaction(
		`settle:${id}:${nonce}`,
		encodeFunctionData({
			abi: escrowAbi,
			functionName: "settle",
			args: [
				id as Hex,
				toChainAmount(cumulative, assetOf(config), decimalsOf(config)),
				BigInt(nonce),
				receiptsHash as Hex,
			],
		}),
	);
	const hash = await broadcastOwnerTransaction(transaction);
	try {
		const confirmed = await confirmSettlement(
			hash,
			id,
			nonce,
			receiptsHash,
			cumulative,
		);
		await recordOwnerTransaction(hash, "CONFIRMED");
		return confirmed;
	} catch (cause) {
		if (cause instanceof EscrowTransactionReverted)
			await recordOwnerTransaction(hash, "REVERTED");
		throw cause;
	}
}
export async function sendClose(id: string) {
	const { config, publicClient } = clients();
	if ((await readSession(id)).closed) return null;
	const transaction = await prepareOwnerTransaction(
		`close:${id}`,
		encodeFunctionData({
			abi: escrowAbi,
			functionName: "closeSession",
			args: [id as Hex],
		}),
	);
	const hash = await broadcastOwnerTransaction(transaction);
	const receipt = await publicClient.waitForTransactionReceipt({
		hash,
		confirmations: config.mode === "local" ? 1 : 6,
	});
	await recordOwnerTransaction(
		hash,
		receipt.status === "success" ? "CONFIRMED" : "REVERTED",
	);
	if (receipt.status !== "success") throw new Error("Close reverted.");
	return receipt.transactionHash;
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
		if (!isNativeAsset(assetOf(config))) {
			const approve = await wallet.writeContract({
				address: getAddress(config.token),
				abi: tokenAbi,
				functionName: "approve",
				args: [
					getAddress(config.escrow),
					toChainAmount(args.budget, assetOf(config), decimalsOf(config)),
				],
			});
			await publicClient.waitForTransactionReceipt({ hash: approve });
		}
		const argsOnChain = [
			args.id as Hex,
			getAddress(args.provider),
			args.termsHash as Hex,
			toChainAmount(args.budget, assetOf(config), decimalsOf(config)),
			BigInt(args.expiresAt),
		] as const;
		const hash = isNativeAsset(assetOf(config))
			? await wallet.writeContract({
					address: getAddress(config.escrow),
					abi: nativeEscrowAbi,
					functionName: "openSession",
					args: argsOnChain,
					value: toChainAmount(
						args.budget,
						assetOf(config),
						decimalsOf(config),
					),
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
	if (receipt.status !== "success")
		throw new EscrowTransactionReverted("Settlement reverted.");
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
					toChainAmount(cumulative, assetOf(config), decimalsOf(config)),
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
			toChainAmount(
				state.budget - state.spent,
				assetOf(config),
				decimalsOf(config),
			)
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
			log.args.cumulativeSpent ===
				toChainAmount(cumulative, assetOf(config), decimalsOf(config)),
	)?.transactionHash;
	return hash
		? confirmSettlement(hash, id, nonce, receiptsHash, cumulative)
		: null;
}
