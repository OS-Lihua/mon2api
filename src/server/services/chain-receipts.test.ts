import {
	encodeAbiParameters,
	encodeEventTopics,
	type Hex,
	type TransactionReceipt,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { escrowAbi } from "~/lib/abi";
import {
	confirmSettlement,
	demoAccount,
	findSessionClose,
	findSessionOpen,
	findSettlement,
	sendSettlement,
} from "./chain";

const mocks = vi.hoisted(() => ({
	client: {
		getContractEvents: vi.fn(),
		waitForTransactionReceipt: vi.fn(),
		getTransactionReceipt: vi.fn(),
		getBlock: vi.fn(),
		getBlockNumber: vi.fn(),
		readContract: vi.fn(),
	},
	wallet: { writeContract: vi.fn() },
	config: {
		mode: "monad-testnet",
		chainId: 10143,
		rpcUrl: "http://127.0.0.1:1",
		escrow: `0x${"11".repeat(20)}`,
		meter: "",
		deploymentBlock: "0",
	},
	db: { $transaction: vi.fn() },
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
const hash = `0x${"56".repeat(32)}` as Hex;
const otherHash = `0x${"78".repeat(32)}` as Hex;
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
function receipt(logs = [log()], status: "success" | "reverted" = "success") {
	return { status, transactionHash: hash, blockNumber: 1n, logs };
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.config.mode = "monad-testnet";
	mocks.config.meter = "0x0000000000000000000000000000000000000000";
	mocks.client.waitForTransactionReceipt.mockResolvedValue(receipt());
	mocks.client.getContractEvents.mockResolvedValue([
		{
			transactionHash: hash,
			removed: false,
			args: { receiptsHash: digest, cumulativeSpent: 20n },
		},
	]);
	mocks.db.$transaction.mockImplementation(
		(fn: (tx: { $queryRaw: () => Promise<unknown> }) => Promise<unknown>) =>
			fn({ $queryRaw: async () => [] }),
	);
});
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
		mocks.config.meter = demoAccount(4).address;
		mocks.client.readContract.mockResolvedValue([
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
		expect(mocks.wallet.writeContract).toHaveBeenCalledWith(
			expect.objectContaining({
				functionName: "settle",
				args: [id, 20n, 0n, digest],
			}),
		);
		mocks.client.waitForTransactionReceipt.mockResolvedValue(
			receipt([log({ cumulative: 19n })]),
		);
		await expect(sendSettlement(id, 20, 0, digest)).rejects.toThrow(
			"committed bill",
		);
	});
	it("validates receipt confirmations inside the send recovery shortcut", async () => {
		mocks.client.readContract.mockResolvedValue([
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
		mocks.client.readContract.mockResolvedValue([
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
			mocks.client.readContract.mockResolvedValue([
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
