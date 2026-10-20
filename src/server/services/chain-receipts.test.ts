import type { ChainTransaction, Prisma } from "@prisma/client";
import {
	decodeFunctionData,
	encodeAbiParameters,
	encodeEventTopics,
	type Hex,
	keccak256,
	type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escrowAbi } from "~/lib/abi";
import {
	confirmSettlement,
	demoAccount,
	findSessionClose,
	findSessionOpen,
	findSettlement,
	ownerWallet,
	sendClose,
	sendSettlement,
} from "./chain";

const mocks = vi.hoisted(() => ({
	owner: "",
	client: {
		getContractEvents: vi.fn(),
		waitForTransactionReceipt: vi.fn(),
		getTransactionReceipt: vi.fn(),
		getBlock: vi.fn(),
		getBlockNumber: vi.fn(),
		readContract: vi.fn(),
		getTransactionCount: vi.fn(),
		sendRawTransaction: vi.fn(),
		getTransaction: vi.fn(),
	},
	wallet: {
		account: { address: "" },
		writeContract: vi.fn(),
		prepareTransactionRequest: vi.fn(),
		signTransaction: vi.fn(),
	},
	config: {
		asset: "USDC" as "ETH" | "USDC",
		mode: "evm",
		chainId: 8453,
		rpcUrl: "http://127.0.0.1:1",
		escrow: `0x${"11".repeat(20)}`,
		deploymentBlock: "0",
	},
	db: {
		$transaction: vi.fn(),
		chainTransaction: {
			findUnique: vi.fn(),
			aggregate: vi.fn(),
			upsert: vi.fn(),
			findMany: vi.fn(),
			updateMany: vi.fn(),
		},
	},
}));
vi.mock("viem", async (original) => ({
	...(await original<typeof import("viem")>()),
	createPublicClient: () => mocks.client,
	createWalletClient: () => mocks.wallet,
}));
vi.mock("~/server/db", () => ({ db: mocks.db }));
vi.mock("./runtime", () => ({
	chainConfig: () => mocks.config,
	demoEnabled: () => false,
}));
const id = `0x${"12".repeat(32)}` as Hex;
const digest = `0x${"34".repeat(32)}` as Hex;
const signed = "0x1122" as const;
const hash = keccak256(signed);
const otherHash = `0x${"78".repeat(32)}` as Hex;
const transactions = new Map<string, ChainTransaction>();
function concreteTopics(
	topics: ReturnType<typeof encodeEventTopics>,
): [Hex, ...Hex[]] | [] {
	if (topics.some((topic) => typeof topic !== "string"))
		throw new Error("Fixture requires concrete event topics");
	const values = topics.filter(
		(topic): topic is Hex => typeof topic === "string",
	);
	const [first, ...rest] = values;
	return first ? [first, ...rest] : [];
}
function log(
	overrides: {
		address?: Hex;
		id?: Hex;
		nonce?: bigint;
		cumulative?: bigint;
		digest?: Hex;
		malformed?: boolean;
	} = {},
): TransactionReceipt["logs"][number] {
	return {
		address: overrides.address ?? (mocks.config.escrow as Hex),
		topics: concreteTopics(
			encodeEventTopics({
				abi: escrowAbi,
				eventName: "UsageSettled",
				args: { id: overrides.id ?? id, nonce: overrides.nonce ?? 0n },
			}),
		),
		data: overrides.malformed
			? "0x"
			: encodeAbiParameters(
					[{ type: "uint256" }, { type: "bytes32" }],
					[overrides.cumulative ?? 20n, overrides.digest ?? digest],
				),
		blockHash: otherHash,
		blockNumber: 1n,
		transactionHash: hash,
		transactionIndex: 0,
		logIndex: 0,
		removed: false,
	};
}
function openingLog(address: Hex, consumer: Hex) {
	return {
		...log(),
		address,
		topics: concreteTopics(
			encodeEventTopics({
				abi: escrowAbi,
				eventName: "SessionOpened",
				args: { id, consumer, provider: address },
			}),
		),
		data: encodeAbiParameters(
			[{ type: "uint256" }, { type: "bytes32" }, { type: "uint64" }],
			[100n, digest, 1n],
		),
	};
}
function mockSession(state: readonly unknown[]) {
	mocks.client.readContract.mockImplementation(
		({ functionName }: { functionName: string }) =>
			functionName === "owner" ? mocks.owner : state,
	);
}
function receipt(logs = [log()], status: "success" | "reverted" = "success") {
	return { status, transactionHash: hash, blockNumber: 1n, logs };
}
beforeEach(() => {
	vi.stubEnv("ESCROW_OWNER_PRIVATE_KEY", "");
	vi.clearAllMocks();
	transactions.clear();
	mocks.wallet.account.address = demoAccount(4).address;
	mocks.wallet.prepareTransactionRequest.mockImplementation(
		async (input) => input,
	);
	mocks.wallet.signTransaction.mockResolvedValue(signed);
	mocks.client.getTransactionCount.mockResolvedValue(0);
	mocks.client.getBlockNumber.mockResolvedValue(0n);
	mocks.client.sendRawTransaction.mockImplementation(
		async ({ serializedTransaction }: { serializedTransaction: Hex }) =>
			keccak256(serializedTransaction),
	);
	mocks.client.getTransaction.mockRejectedValue(
		new Error("Unknown transaction"),
	);
	mocks.db.chainTransaction.findUnique.mockImplementation(
		async ({ where }: { where: { id: string } }) =>
			transactions.get(where.id) ?? null,
	);
	mocks.db.chainTransaction.aggregate.mockImplementation(async () => ({
		_max: {
			nonce: Math.max(
				-1,
				...Array.from(transactions.values(), (row) => row.nonce),
			),
		},
	}));
	mocks.db.chainTransaction.upsert.mockImplementation(
		async ({ create }: { create: Prisma.ChainTransactionCreateInput }) => {
			const value: ChainTransaction = {
				...create,
				status: create.status ?? "PENDING",
				createdAt: new Date(),
			};
			transactions.set(create.id, value);
			return value;
		},
	);
	mocks.db.chainTransaction.findMany.mockImplementation(
		async ({ where }: { where: { sender: string; nonce: { lte: number } } }) =>
			Array.from(transactions.values())
				.filter(
					(row) =>
						row.status === "PENDING" &&
						row.sender === where.sender &&
						row.nonce <= where.nonce.lte,
				)
				.sort((a, b) => a.nonce - b.nonce),
	);
	mocks.db.chainTransaction.updateMany.mockImplementation(
		async ({
			where,
			data,
		}: {
			where: { hash: string };
			data: { status: string };
		}) => {
			for (const row of transactions.values())
				if (row.hash === where.hash) row.status = data.status;
			return { count: 1 };
		},
	);
	mocks.config.asset = "USDC";
	mocks.config.mode = "evm";
	mocks.owner = "0x0000000000000000000000000000000000000000";
	mocks.client.waitForTransactionReceipt.mockResolvedValue(receipt());
	mocks.client.getContractEvents.mockResolvedValue([
		{
			transactionHash: hash,
			removed: false,
			args: { receiptsHash: digest, cumulativeSpent: 20n },
		},
	]);
	mocks.db.$transaction.mockImplementation(
		(
			fn: (tx: {
				$queryRaw: () => Promise<unknown>;
				chainTransaction: typeof mocks.db.chainTransaction;
			}) => Promise<unknown>,
		) =>
			fn({
				$queryRaw: async () => [],
				chainTransaction: mocks.db.chainTransaction,
			}),
	);
});
afterEach(() => vi.unstubAllEnvs());
describe("contract wallet opening receipts", () => {
	it("accepts a relayer transaction addressed to a wallet if the escrow emitted the opening event", async () => {
		const wallet = `0x${"33".repeat(20)}` as Hex;
		const blockHash = `0x${"44".repeat(32)}` as Hex;
		const safeReceipt = {
			...receipt([openingLog(mocks.config.escrow as Hex, wallet)]),
			to: wallet,
			from: `0x${"55".repeat(20)}` as Hex,
			blockHash,
		};
		mocks.client.waitForTransactionReceipt.mockResolvedValue(safeReceipt);
		mocks.client.getTransactionReceipt.mockResolvedValue(safeReceipt);
		mocks.client.getBlock.mockResolvedValue({ hash: blockHash });
		mocks.client.getBlockNumber.mockResolvedValue(6n);
		await expect(findSessionOpen(id, hash)).resolves.toMatchObject({
			receipt: { transactionHash: hash, to: wallet },
			event: { args: { id, consumer: wallet, budget: 100n } },
		});
		expect(mocks.client.waitForTransactionReceipt).toHaveBeenCalledWith({
			hash,
			confirmations: 6,
		});
	});

	it("does not trust an event emitted by another contract", async () => {
		const foreign = `0x${"22".repeat(20)}` as Hex;
		const blockHash = `0x${"44".repeat(32)}` as Hex;
		const foreignReceipt = {
			...receipt([openingLog(foreign, foreign)]),
			blockHash,
		};
		mocks.client.waitForTransactionReceipt.mockResolvedValue(foreignReceipt);
		mocks.client.getTransactionReceipt.mockResolvedValue(foreignReceipt);
		mocks.client.getBlock.mockResolvedValue({ hash: blockHash });
		mocks.client.getBlockNumber.mockResolvedValue(6n);
		await expect(findSessionOpen(id, hash)).resolves.toBeNull();
	});
});

describe("canonical settlement receipts", () => {
	it("rejects a retired signer using the current on-chain owner", async () => {
		mocks.config.mode = "local";
		mocks.client.readContract.mockResolvedValue(demoAccount(5).address);
		await expect(ownerWallet()).rejects.toThrow("not the current escrow owner");
		expect(mocks.wallet.writeContract).not.toHaveBeenCalled();
	});
	it("checks ownership afresh after a handover instead of retaining the earlier owner", async () => {
		mocks.config.mode = "local";
		mocks.client.readContract
			.mockResolvedValueOnce(demoAccount(4).address)
			.mockResolvedValueOnce(demoAccount(5).address);
		await expect(ownerWallet()).resolves.toBe(mocks.wallet);
		await expect(ownerWallet()).rejects.toThrow("not the current escrow owner");
	});
	it("waits for six confirmations before accepting a discovered settlement", async () => {
		let release!: () => void;
		mocks.client.waitForTransactionReceipt.mockImplementation(async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return receipt();
		});
		let finished = false;
		const recovering = findSettlement(id, 0, digest, 20).then((value) => {
			finished = true;
			return value;
		});
		await vi.waitFor(() =>
			expect(mocks.client.waitForTransactionReceipt).toHaveBeenCalledWith({
				hash,
				confirmations: 6,
			}),
		);
		expect(finished).toBe(false);
		release();
		await expect(recovering).resolves.toBe(hash);
	});
	it("uses one confirmation only on the isolated local chain", async () => {
		mocks.config.mode = "local";
		await confirmSettlement(hash, id, 0, digest, 20);
		expect(mocks.client.waitForTransactionReceipt).toHaveBeenCalledWith({
			hash,
			confirmations: 1,
		});
	});
	it.each([
		["contract", { address: `0x${"22".repeat(20)}` as Hex }],
		["session", { id: otherHash }],
		["nonce", { nonce: 1n }],
		["cumulative amount", { cumulative: 21n }],
		["receipts digest", { digest: otherHash }],
		["malformed event", { malformed: true }],
	] as const)(
		"rejects a receipt with the wrong %s",
		async (_name, overrides) => {
			mocks.client.waitForTransactionReceipt.mockResolvedValue(
				receipt([log(overrides)]),
			);
			await expect(findSettlement(id, 0, digest, 20)).rejects.toThrow(
				"committed bill",
			);
		},
	);
	it("rejects a reverted receipt", async () => {
		mocks.client.waitForTransactionReceipt.mockResolvedValue(
			receipt([], "reverted"),
		);
		await expect(findSettlement(id, 0, digest, 20)).rejects.toThrow("reverted");
	});
	it("does not recover removed logs or another cumulative bill", async () => {
		mocks.client.getContractEvents.mockResolvedValue([
			{
				transactionHash: hash,
				removed: true,
				args: { receiptsHash: digest, cumulativeSpent: 20n },
			},
			{
				transactionHash: otherHash,
				args: { receiptsHash: digest, cumulativeSpent: 21n },
			},
		]);
		await expect(findSettlement(id, 0, digest, 20)).resolves.toBeNull();
		expect(mocks.client.waitForTransactionReceipt).not.toHaveBeenCalled();
	});
	it("validates the exact receipt on a normal send", async () => {
		mocks.config.mode = "local";
		mocks.owner = demoAccount(4).address;
		mockSession([
			mocks.config.escrow,
			mocks.config.escrow,
			digest,
			100n,
			0n,
			0n,
			1n,
			0n,
			false,
		]);
		mocks.wallet.writeContract.mockResolvedValue(hash);
		await expect(sendSettlement(id, 20, 0, digest)).resolves.toBe(hash);
		const request = mocks.wallet.prepareTransactionRequest.mock.calls[0]?.[0];
		expect(request).toMatchObject({ to: mocks.config.escrow, nonce: 0 });
		expect(
			decodeFunctionData({ abi: escrowAbi, data: request.data }),
		).toMatchObject({ functionName: "settle", args: [id, 20n, 0n, digest] });
		mocks.client.waitForTransactionReceipt.mockResolvedValue(
			receipt([log({ cumulative: 19n })]),
		);
		await expect(sendSettlement(id, 20, 0, digest)).rejects.toThrow(
			"committed bill",
		);
	});
	it("validates receipt confirmations inside the send recovery shortcut", async () => {
		mockSession([
			mocks.config.escrow,
			mocks.config.escrow,
			digest,
			100n,
			20n,
			1n,
			1n,
			0n,
			false,
		]);
		await expect(sendSettlement(id, 20, 0, digest)).resolves.toBe(hash);
		expect(mocks.wallet.writeContract).not.toHaveBeenCalled();
		expect(mocks.client.waitForTransactionReceipt).toHaveBeenCalledWith({
			hash,
			confirmations: 6,
		});
	});
});
describe("confirmed chain closure evidence", () => {
	function closedLog(refund = 80n, address = mocks.config.escrow as Hex) {
		return {
			...log(),
			address,
			topics: concreteTopics(
				encodeEventTopics({
					abi: escrowAbi,
					eventName: "SessionClosed",
					args: { id },
				}),
			),
			data: encodeAbiParameters([{ type: "uint256" }], [refund]),
		};
	}
	it("checks the close receipt and reads the immutable closed state at its block", async () => {
		mocks.client.getContractEvents.mockResolvedValue([
			{ transactionHash: hash, removed: false },
		]);
		mocks.client.waitForTransactionReceipt.mockResolvedValue(
			receipt([closedLog()]),
		);
		mockSession([
			mocks.config.escrow,
			mocks.config.escrow,
			digest,
			100n,
			20n,
			1n,
			1n,
			0n,
			true,
		]);
		await expect(findSessionClose(id)).resolves.toMatchObject({
			txHash: hash,
			state: { closed: true, spent: 20 },
		});
		expect(mocks.client.waitForTransactionReceipt).toHaveBeenCalledWith({
			hash,
			confirmations: 6,
		});
		expect(mocks.client.readContract).toHaveBeenCalledWith(
			expect.objectContaining({ blockNumber: 1n }),
		);
	});
	it.each(["foreign contract", "wrong refund", "not closed"])(
		"rejects %s closure evidence",
		async (kind) => {
			mocks.client.getContractEvents.mockResolvedValue([
				{ transactionHash: hash },
			]);
			mocks.client.waitForTransactionReceipt.mockResolvedValue(
				receipt([
					closedLog(
						kind === "wrong refund" ? 79n : 80n,
						kind === "foreign contract" ? `0x${"22".repeat(20)}` : undefined,
					),
				]),
			);
			mockSession([
				mocks.config.escrow,
				mocks.config.escrow,
				digest,
				100n,
				20n,
				1n,
				1n,
				0n,
				kind !== "not closed",
			]);
			await expect(findSessionClose(id)).rejects.toThrow();
		},
	);
});

describe("durable owner transaction queue", () => {
	function signer() {
		// Unfunded fixture key, used only by mocked transports.
		const privateKey = `0x${"77".repeat(32)}` as Hex;
		vi.stubEnv("ESCROW_OWNER_PRIVATE_KEY", privateKey);
		mocks.owner = privateKeyToAccount(privateKey).address;
		mocks.wallet.account.address = mocks.owner;
		mockSession([
			mocks.owner,
			mocks.owner,
			digest,
			100n,
			0n,
			0n,
			1n,
			0n,
			false,
		]);
	}
	it("lets a second session broadcast while the first waits for six confirmations", async () => {
		signer();
		const secondId = `0x${"ab".repeat(32)}` as Hex;
		const secondRaw = "0x3344" as const;
		const secondHash = keccak256(secondRaw);
		mocks.wallet.signTransaction
			.mockResolvedValueOnce(signed)
			.mockResolvedValueOnce(secondRaw);
		let release!: () => void;
		const waiting = new Promise<void>((resolve) => {
			release = resolve;
		});
		mocks.client.waitForTransactionReceipt.mockImplementation(
			async ({ hash: requested }: { hash: Hex }) => {
				if (requested === hash) await waiting;
				return {
					...receipt([log({ id: requested === hash ? id : secondId })]),
					transactionHash: requested,
				};
			},
		);
		const first = sendSettlement(id, 20, 0, digest);
		await vi.waitFor(() =>
			expect(mocks.client.waitForTransactionReceipt).toHaveBeenCalledWith({
				hash,
				confirmations: 6,
			}),
		);
		try {
			const second = sendSettlement(secondId, 20, 0, digest);
			await expect(second).resolves.toBe(secondHash);
			expect(
				mocks.wallet.prepareTransactionRequest.mock.calls.map(
					([request]) => request.nonce,
				),
			).toEqual([0, 1]);
			expect(transactions.get(`settle:${id}:0`)?.status).toBe("PENDING");
		} finally {
			release();
		}
		await expect(first).resolves.toBe(hash);
	});
	it("commits the signed transaction before broadcasting and reuses it after a lost response", async () => {
		signer();
		let locked = false;
		mocks.db.$transaction.mockImplementation(async (action) => {
			locked = true;
			try {
				return await action({
					$queryRaw: async () => [],
					chainTransaction: mocks.db.chainTransaction,
				});
			} finally {
				locked = false;
			}
		});
		mocks.client.sendRawTransaction.mockImplementationOnce(async () => {
			expect(locked).toBe(false);
			expect(transactions.get(`settle:${id}:0`)).toMatchObject({
				raw: signed,
				hash,
				nonce: 0,
			});
			throw new Error("Broadcast response lost");
		});
		await expect(sendSettlement(id, 20, 0, digest)).rejects.toThrow(
			"response lost",
		);
		expect(transactions.get(`settle:${id}:0`)?.status).toBe("PENDING");
		await expect(sendSettlement(id, 20, 0, digest)).resolves.toBe(hash);
		expect(mocks.wallet.signTransaction).toHaveBeenCalledTimes(1);
		expect(transactions.get(`settle:${id}:0`)?.status).toBe("CONFIRMED");
	});
	it("treats an already-known signed transaction as the same submission", async () => {
		signer();
		mocks.client.sendRawTransaction.mockRejectedValueOnce(
			new Error("already known"),
		);
		mocks.client.getTransaction.mockResolvedValue({ hash });
		await expect(sendSettlement(id, 20, 0, digest)).resolves.toBe(hash);
		expect(mocks.wallet.signTransaction).toHaveBeenCalledTimes(1);
	});
	it("replays a saved lower nonce before broadcasting a new session", async () => {
		signer();
		transactions.set("saved-before-crash", {
			id: "saved-before-crash",
			sender: mocks.owner.toLowerCase(),
			nonce: 4,
			raw: "0xaabb",
			hash: keccak256("0xaabb"),
			status: "PENDING",
			createdAt: new Date(),
		});
		await expect(sendSettlement(id, 20, 0, digest)).resolves.toBe(hash);
		expect(mocks.wallet.prepareTransactionRequest).toHaveBeenCalledWith(
			expect.objectContaining({ nonce: 5 }),
		);
		expect(
			mocks.client.sendRawTransaction.mock.calls.map(
				([request]) => request.serializedTransaction,
			),
		).toEqual(["0xaabb", signed]);
	});
	it("only prepares a new nonce after a confirmed reverted transaction", async () => {
		signer();
		mocks.client.waitForTransactionReceipt.mockResolvedValueOnce(
			receipt([], "reverted"),
		);
		await expect(sendSettlement(id, 20, 0, digest)).rejects.toThrow("reverted");
		expect(transactions.get(`settle:${id}:0`)?.status).toBe("REVERTED");
		mocks.wallet.signTransaction.mockResolvedValueOnce("0x3344");
		mocks.client.waitForTransactionReceipt.mockResolvedValueOnce({
			...receipt(),
			transactionHash: keccak256("0x3344"),
		});
		await expect(sendSettlement(id, 20, 0, digest)).resolves.toBe(
			keccak256("0x3344"),
		);
		expect(
			mocks.wallet.prepareTransactionRequest.mock.calls.map(
				([request]) => request.nonce,
			),
		).toEqual([0, 1]);
	});
	it("does not let a nonce consumed by a confirmed administrator transaction block later sessions", async () => {
		signer();
		transactions.set("superseded", {
			id: "superseded",
			sender: mocks.owner.toLowerCase(),
			nonce: 4,
			raw: "0xaabb",
			hash: keccak256("0xaabb"),
			status: "PENDING",
			createdAt: new Date(),
		});
		mocks.client.sendRawTransaction.mockRejectedValueOnce(
			new Error("nonce already used"),
		);
		mocks.client.getBlockNumber.mockResolvedValue(10n);
		mocks.client.getTransactionCount.mockResolvedValue(5);
		await expect(sendSettlement(id, 20, 0, digest)).resolves.toBe(hash);
		expect(transactions.get("superseded")?.status).toBe("CONSUMED");
		expect(mocks.client.getTransactionCount).toHaveBeenCalledWith({
			address: mocks.owner,
			blockNumber: 5n,
		});
	});
	it("waits for a session close after releasing its signing transaction", async () => {
		signer();
		mocks.client.waitForTransactionReceipt.mockImplementation(async () => {
			expect(transactions.get(`close:${id}`)).toMatchObject({
				nonce: 0,
				status: "PENDING",
			});
			return receipt();
		});
		await expect(sendClose(id)).resolves.toBe(hash);
		expect(transactions.get(`close:${id}`)?.status).toBe("CONFIRMED");
	});
});

it("sends and recovers native token settlements using exact wei receipts", async () => {
	mocks.config.asset = "ETH";
	mocks.config.mode = "local";
	mocks.owner = demoAccount(4).address;
	mockSession([
		mocks.config.escrow,
		mocks.config.escrow,
		digest,
		100_000_000_000_000n,
		0n,
		0n,
		1n,
		0n,
		false,
	]);
	mocks.client.waitForTransactionReceipt.mockResolvedValue(
		receipt([log({ cumulative: 20_000_000_000_000n })]),
	);
	mocks.wallet.writeContract.mockResolvedValue(hash);
	await expect(sendSettlement(id, 20, 0, digest)).resolves.toBe(hash);
	const request = mocks.wallet.prepareTransactionRequest.mock.calls[0]?.[0];
	expect(
		decodeFunctionData({ abi: escrowAbi, data: request.data }),
	).toMatchObject({ args: [id, 20_000_000_000_000n, 0n, digest] });
	mocks.client.getContractEvents.mockResolvedValue([
		{
			transactionHash: hash,
			removed: false,
			args: { receiptsHash: digest, cumulativeSpent: 20_000_000_000_000n },
		},
	]);
	await expect(findSettlement(id, 0, digest, 20)).resolves.toBe(hash);
	mocks.client.waitForTransactionReceipt.mockResolvedValue(
		receipt([log({ cumulative: 20n })]),
	);
	await expect(confirmSettlement(hash, id, 0, digest, 20)).rejects.toThrow(
		"committed bill",
	);
});
