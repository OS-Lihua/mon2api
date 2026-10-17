import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ganache from "ganache";
import {
	type Abi,
	type Address,
	createPublicClient,
	createWalletClient,
	custom,
	type Hex,
	keccak256,
	stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";
import { escrowAbi, tokenAbi } from "../src/lib/abi";

type Artifact = { abi: Abi; bytecode: Hex };
const sessionId = keccak256(stringToHex("session-one"));
const termsHash = keccak256(stringToHex("fixed price terms"));
const receiptHash = keccak256(stringToHex("usage batch"));
const budget = 10_000n;

async function deployFixture() {
	const provider = ganache.provider({
		logging: { quiet: true },
		chain: {
			chainId: foundry.id,
			hardfork: "shanghai",
			vmErrorsOnRPCResponse: true,
		},
		wallet: { deterministic: true, totalAccounts: 5 },
	});
	const secrets = Object.values(provider.getInitialAccounts());
	const wallets = secrets.map(({ secretKey }) =>
		createWalletClient({
			account: privateKeyToAccount(secretKey as Hex),
			chain: foundry,
			transport: custom(provider, { retryCount: 0 }),
		}),
	);
	const walletAt = (index: number) => {
		const wallet = wallets[index];
		if (!wallet) throw new Error("Missing local EVM test account");
		return wallet;
	};
	const consumer = walletAt(0);
	const meter = walletAt(1);
	const supplier = walletAt(2);
	const treasury = walletAt(3);
	const stranger = walletAt(4);
	const client = createPublicClient({
		chain: foundry,
		transport: custom(provider, { retryCount: 0 }),
		cacheTime: 0,
		pollingInterval: 20,
	});
	const tokenArtifact = JSON.parse(
		readFileSync("contracts/artifacts/DemoUSD.json", "utf8"),
	) as Artifact;
	const escrowArtifact = JSON.parse(
		readFileSync("contracts/artifacts/UsageEscrow.json", "utf8"),
	) as Artifact;
	const tokenTx = await consumer.deployContract(tokenArtifact);
	const tokenReceipt = await client.waitForTransactionReceipt({
		hash: tokenTx,
	});
	if (!tokenReceipt.contractAddress)
		throw new Error("Token deployment did not return an address");
	const token = tokenReceipt.contractAddress;
	const escrowTx = await consumer.deployContract({
		...escrowArtifact,
		args: [token, meter.account.address, treasury.account.address, 500],
	});
	const escrowReceipt = await client.waitForTransactionReceipt({
		hash: escrowTx,
	});
	if (!escrowReceipt.contractAddress)
		throw new Error("Escrow deployment did not return an address");
	const escrow = escrowReceipt.contractAddress;
	await consumer.writeContract({
		address: token,
		abi: tokenAbi,
		functionName: "mint",
		args: [consumer.account.address, budget],
	});
	await consumer.writeContract({
		address: token,
		abi: tokenAbi,
		functionName: "approve",
		args: [escrow, budget],
	});

	async function open() {
		const block = await client.getBlock();
		await consumer.writeContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "openSession",
			args: [
				sessionId,
				supplier.account.address,
				termsHash,
				budget,
				block.timestamp + 300n,
			],
		});
	}
	const settle = (amount: bigint, nonce: bigint) =>
		meter.writeContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "settle",
			args: [sessionId, amount, nonce, receiptHash],
		});
	const close = () =>
		meter.writeContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "closeSession",
			args: [sessionId],
		});
	const session = () =>
		client.readContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "sessions",
			args: [sessionId],
		});
	const claimable = (owner: Address) =>
		client.readContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "claimable",
			args: [owner],
		});
	const balance = (owner: Address) =>
		client.readContract({
			address: token,
			abi: tokenAbi,
			functionName: "balanceOf",
			args: [owner],
		});
	const advance = async (seconds: number) => {
		await provider.request({ method: "evm_increaseTime", params: [seconds] });
		await provider.request({ method: "evm_mine", params: [] });
	};
	return {
		provider,
		client,
		consumer,
		meter,
		supplier,
		treasury,
		stranger,
		token,
		escrow,
		open,
		settle,
		close,
		session,
		claimable,
		balance,
		advance,
	};
}

describe("UsageEscrow with a real local EVM", { timeout: 30_000 }, () => {
	let fixture: Awaited<ReturnType<typeof deployFixture>>;
	let snapshot: string;

	beforeAll(async () => {
		execFileSync(process.execPath, ["scripts/compile.mjs"]);
		fixture = await deployFixture();
	}, 30_000);
	beforeEach(async () => {
		snapshot = await fixture.provider.request({
			method: "evm_snapshot",
			params: [],
		});
	});
	afterEach(async () => {
		await fixture.provider.request({
			method: "evm_revert",
			params: [snapshot],
		});
	});
	afterAll(async () => {
		await fixture?.provider.disconnect();
	});

	it("uses 6 decimals and binds an immutable consumer, provider, budget and terms", async () => {
		const f = fixture;
		expect(
			await f.client.readContract({
				address: f.token,
				abi: tokenAbi,
				functionName: "decimals",
			}),
		).toBe(6);
		await f.open();
		const s = await f.session();
		expect(s.slice(0, 5)).toEqual([
			f.consumer.account.address,
			f.supplier.account.address,
			termsHash,
			budget,
			0n,
		]);
		expect(await f.balance(f.escrow)).toBe(budget);
		await expect(f.open()).rejects.toThrow("session exists");
	});

	it("conserves all deposited tokens through settlement, refund and withdrawals", async () => {
		const f = fixture;
		await f.open();
		await f.settle(4_001n, 0n);
		await f.close();
		expect(await f.claimable(f.supplier.account.address)).toBe(3_801n);
		expect(await f.claimable(f.treasury.account.address)).toBe(200n);
		expect(await f.claimable(f.consumer.account.address)).toBe(5_999n);
		for (const wallet of [f.supplier, f.treasury, f.consumer]) {
			await wallet.writeContract({
				address: f.escrow,
				abi: escrowAbi,
				functionName: "withdraw",
			});
			expect(await f.claimable(wallet.account.address)).toBe(0n);
		}
		expect(await f.balance(f.escrow)).toBe(0n);
		expect(
			(await f.balance(f.supplier.account.address)) +
				(await f.balance(f.treasury.account.address)) +
				(await f.balance(f.consumer.account.address)),
		).toBe(budget);
		await expect(
			f.consumer.writeContract({
				address: f.escrow,
				abi: escrowAbi,
				functionName: "withdraw",
			}),
		).rejects.toThrow("nothing to withdraw");
	});

	it("rejects unauthorized settlement and early closure without moving money", async () => {
		const f = fixture;
		await f.open();
		await expect(
			f.stranger.writeContract({
				address: f.escrow,
				abi: escrowAbi,
				functionName: "settle",
				args: [sessionId, 100n, 0n, receiptHash],
			}),
		).rejects.toThrow("meter only");
		await expect(
			f.stranger.writeContract({
				address: f.escrow,
				abi: escrowAbi,
				functionName: "requestClose",
				args: [sessionId],
			}),
		).rejects.toThrow("cannot close");
		await expect(
			f.consumer.writeContract({
				address: f.escrow,
				abi: escrowAbi,
				functionName: "closeSession",
				args: [sessionId],
			}),
		).rejects.toThrow("await settlement window");
		expect((await f.session())[4]).toBe(0n);
		expect(await f.claimable(f.supplier.account.address)).toBe(0n);
	});

	it("rejects over-budget, non-increasing, missing-receipt and replayed settlements", async () => {
		const f = fixture;
		await f.open();
		await expect(f.settle(budget + 1n, 0n)).rejects.toThrow("invalid amount");
		await expect(f.settle(0n, 0n)).rejects.toThrow("invalid amount");
		await expect(
			f.meter.writeContract({
				address: f.escrow,
				abi: escrowAbi,
				functionName: "settle",
				args: [sessionId, 100n, 0n, `0x${"00".repeat(32)}`],
			}),
		).rejects.toThrow("invalid receipt");
		await f.settle(100n, 0n);
		await expect(f.settle(200n, 0n)).rejects.toThrow("invalid receipt");
		await expect(f.settle(100n, 1n)).rejects.toThrow("invalid amount");
		await expect(f.settle(50n, 1n)).rejects.toThrow("invalid amount");
		expect((await f.session())[4]).toBe(100n);
	});

	it("charges the same 5% fee across tiny cumulative settlements", async () => {
		const f = fixture;
		await f.open();
		await f.settle(1n, 0n);
		await f.settle(19n, 1n);
		expect(await f.claimable(f.treasury.account.address)).toBe(0n);
		await f.settle(20n, 2n);
		expect(await f.claimable(f.treasury.account.address)).toBe(1n);
		await f.settle(39n, 3n);
		await f.settle(101n, 4n);
		expect(await f.claimable(f.treasury.account.address)).toBe(5n);
		expect(await f.claimable(f.supplier.account.address)).toBe(96n);
	});

	it("settles in-flight usage during consumer close grace then refunds without the meter", async () => {
		const f = fixture;
		await f.open();
		await f.consumer.writeContract({
			address: f.escrow,
			abi: escrowAbi,
			functionName: "requestClose",
			args: [sessionId],
		});
		await expect(
			f.consumer.writeContract({
				address: f.escrow,
				abi: escrowAbi,
				functionName: "requestClose",
				args: [sessionId],
			}),
		).rejects.toThrow("cannot close");
		await f.settle(1_000n, 0n);
		await f.advance(121);
		await expect(f.settle(2_000n, 1n)).rejects.toThrow("settlement expired");
		await f.consumer.writeContract({
			address: f.escrow,
			abi: escrowAbi,
			functionName: "closeSession",
			args: [sessionId],
		});
		expect(await f.claimable(f.consumer.account.address)).toBe(9_000n);
		expect((await f.session())[8]).toBe(true);
		await expect(f.settle(2_000n, 1n)).rejects.toThrow("inactive session");
		await expect(f.close()).rejects.toThrow("inactive session");
	});

	it("permits timeout exit even when the meter never responds", async () => {
		const f = fixture;
		await f.open();
		await f.advance(421);
		await f.stranger.writeContract({
			address: f.escrow,
			abi: escrowAbi,
			functionName: "closeSession",
			args: [sessionId],
		});
		expect(await f.claimable(f.consumer.account.address)).toBe(budget);
		expect(await f.claimable(f.stranger.account.address)).toBe(0n);
		await f.consumer.writeContract({
			address: f.escrow,
			abi: escrowAbi,
			functionName: "withdraw",
		});
		expect(await f.balance(f.consumer.account.address)).toBe(budget);
	});

	it("never lets a late close request extend the original expiry settlement window", async () => {
		const f = fixture;
		await f.open();
		const expiry = (await f.session())[6];
		await f.advance(350);
		await f.consumer.writeContract({
			address: f.escrow,
			abi: escrowAbi,
			functionName: "requestClose",
			args: [sessionId],
		});
		expect((await f.session())[7]).toBe(expiry + 120n);
		await f.advance(71);
		await f.consumer.writeContract({
			address: f.escrow,
			abi: escrowAbi,
			functionName: "closeSession",
			args: [sessionId],
		});
		expect(await f.claimable(f.consumer.account.address)).toBe(budget);
	});
});
