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
	zeroAddress,
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

// Artifacts are generated from repository source in beforeAll, never supplied externally.
const artifact = (name: string) =>
	JSON.parse(readFileSync(`contracts/artifacts/${name}.json`, "utf8")) as {
		abi: Abi;
		bytecode: Hex;
	};
const digest = `0x${"ab".repeat(32)}` as Hex;

async function fixture(native: boolean) {
	const provider = ganache.provider({
		logging: { quiet: true },
		chain: {
			chainId: 31337,
			hardfork: "shanghai",
			vmErrorsOnRPCResponse: true,
		},
		wallet: { deterministic: true, totalAccounts: 4 },
	});
	const transport = custom(provider, { retryCount: 0 });
	const client = createPublicClient({
		chain: foundry,
		transport,
		cacheTime: 0,
		pollingInterval: 10,
	});
	const wallets = Object.values(provider.getInitialAccounts()).map(
		({ secretKey }) =>
			createWalletClient({
				chain: foundry,
				transport,
				account: privateKeyToAccount(secretKey as Hex),
			}),
	);
	const [buyer, owner, seller, nextOwner] = wallets;
	if (!buyer || !owner || !seller || !nextOwner)
		throw new Error("Missing control test wallets");
	type Wallet = typeof buyer;
	const deploy = async (name: string, args: readonly unknown[] = []) => {
		const receipt = await client.waitForTransactionReceipt({
			hash: await buyer.deployContract({ ...artifact(name), args }),
		});
		if (!receipt.contractAddress) throw new Error("Missing test contract");
		return receipt.contractAddress;
	};
	const tokenArtifact = artifact("DemoUSDC");
	const token = native ? zeroAddress : await deploy("DemoUSDC");
	const escrowArtifact = artifact(native ? "NativeUsageEscrow" : "UsageEscrow");
	const escrow = await deploy(native ? "NativeUsageEscrow" : "UsageEscrow", [
		...(native ? [] : [token]),
		owner.account.address,
		500,
	]);
	const unit = native ? 10n ** 12n : 1n;
	const budget = 10_000n * unit;
	const id = `0x${buyer.account.address.slice(2)}${"01".repeat(12)}` as Hex;
	const secondId =
		`0x${buyer.account.address.slice(2)}${"02".repeat(12)}` as Hex;
	const write = (
		wallet: Wallet,
		functionName: string,
		args: readonly unknown[] = [],
		value?: bigint,
	) =>
		wallet.writeContract({
			address: escrow,
			abi: escrowArtifact.abi,
			functionName,
			args,
			...(value === undefined ? {} : { value }),
		});
	const read = (functionName: string, args: readonly unknown[] = []) =>
		client.readContract({
			address: escrow,
			abi: escrowArtifact.abi,
			functionName,
			args,
		});
	const claimable = (address: Address) => read("claimable", [address]);
	const balance = () =>
		native
			? client.getBalance({ address: escrow })
			: client.readContract({
					address: token,
					abi: tokenArtifact.abi,
					functionName: "balanceOf",
					args: [escrow],
				});
	if (!native) {
		await buyer.writeContract({
			address: token,
			abi: tokenArtifact.abi,
			functionName: "mint",
			args: [buyer.account.address, budget * 2n],
		});
		await buyer.writeContract({
			address: token,
			abi: tokenArtifact.abi,
			functionName: "approve",
			args: [escrow, budget * 2n],
		});
	}
	const open = async (sessionId = id) =>
		write(
			buyer,
			"openSession",
			[
				sessionId,
				seller.account.address,
				digest,
				budget,
				(await client.getBlock()).timestamp + 3600n,
			],
			native ? budget : undefined,
		);
	const settle = (wallet: Wallet, amount: bigint, nonce: bigint) =>
		write(wallet, "settle", [id, amount, nonce, digest]);
	const advance = async (seconds: number) => {
		await provider.request({ method: "evm_increaseTime", params: [seconds] });
		await provider.request({ method: "evm_mine", params: [] });
	};
	return {
		provider,
		client,
		buyer,
		owner,
		seller,
		nextOwner,
		escrow,
		token,
		escrowArtifact,
		unit,
		budget,
		id,
		secondId,
		deploy,
		write,
		read,
		claimable,
		balance,
		open,
		settle,
		advance,
	};
}

describe.each([false, true])(
	"single-wallet escrow control (native=%s)",
	(native) => {
		let f: Awaited<ReturnType<typeof fixture>>;
		let snapshot: string;
		beforeAll(async () => {
			execFileSync(process.execPath, ["scripts/compile.mjs", "--test-tokens"]);
			f = await fixture(native);
		}, 30_000);
		beforeEach(async () => {
			snapshot = await f.provider.request({
				method: "evm_snapshot",
				params: [],
			});
		});
		afterEach(async () => {
			await f.provider.request({ method: "evm_revert", params: [snapshot] });
		});
		afterAll(async () => {
			await f?.provider.disconnect();
		});

		it("requires the current owner for administration and never permits renouncing ownership", async () => {
			expect(await f.read("owner")).toBe(f.owner.account.address);
			expect(await f.read("pendingOwner")).toBe(zeroAddress);
			for (const method of [
				"pause",
				"unpause",
				"acceptOwnership",
				"renounceOwnership",
			]) {
				await expect(f.write(f.seller, method)).rejects.toThrow("revert");
			}
			await expect(
				f.write(f.seller, "transferOwnership", [f.nextOwner.account.address]),
			).rejects.toThrow("revert");
			await expect(f.write(f.owner, "renounceOwnership")).rejects.toThrow(
				"ownership required",
			);
			expect(await f.read("owner")).toBe(f.owner.account.address);
			await expect(
				f.deploy(native ? "NativeUsageEscrow" : "UsageEscrow", [
					...(native ? [] : [f.token]),
					zeroAddress,
					500,
				]),
			).rejects.toThrow("revert");
		});

		it("transfers metering and future fees only after acceptance without moving earned balances", async () => {
			await f.open();
			await f.settle(f.owner, 2000n * f.unit, 0n);
			const oldFee = await f.claimable(f.owner.account.address);
			await f.write(f.owner, "transferOwnership", [
				f.nextOwner.account.address,
			]);
			expect(await f.read("owner")).toBe(f.owner.account.address);
			expect(await f.read("pendingOwner")).toBe(f.nextOwner.account.address);
			await expect(f.settle(f.nextOwner, 4000n * f.unit, 1n)).rejects.toThrow(
				"revert",
			);
			await expect(f.write(f.nextOwner, "pause")).rejects.toThrow("revert");
			await expect(f.write(f.seller, "acceptOwnership")).rejects.toThrow(
				"revert",
			);
			await f.write(f.nextOwner, "acceptOwnership");
			expect(await f.read("owner")).toBe(f.nextOwner.account.address);
			expect(await f.read("pendingOwner")).toBe(zeroAddress);
			await expect(f.settle(f.owner, 4000n * f.unit, 1n)).rejects.toThrow(
				"revert",
			);
			await expect(f.write(f.owner, "pause")).rejects.toThrow("revert");
			await expect(
				f.write(f.owner, "transferOwnership", [f.owner.account.address]),
			).rejects.toThrow("revert");
			await expect(f.write(f.owner, "closeSession", [f.id])).rejects.toThrow(
				"await settlement window",
			);
			await f.settle(f.nextOwner, 4000n * f.unit, 1n);
			expect(await f.claimable(f.owner.account.address)).toBe(oldFee);
			expect(await f.claimable(f.nextOwner.account.address)).toBe(oldFee);
			await f.write(f.nextOwner, "closeSession", [f.id]);
			for (const wallet of [f.buyer, f.owner, f.seller, f.nextOwner])
				await f.write(wallet, "withdraw");
			expect(await f.balance()).toBe(0n);
		});

		it("can cancel and replace a pending handover without granting the canceled wallet authority", async () => {
			await f.write(f.owner, "transferOwnership", [
				f.nextOwner.account.address,
			]);
			await f.write(f.owner, "transferOwnership", [zeroAddress]);
			await expect(f.write(f.nextOwner, "acceptOwnership")).rejects.toThrow(
				"revert",
			);
			await f.write(f.owner, "transferOwnership", [
				f.nextOwner.account.address,
			]);
			await f.write(f.owner, "transferOwnership", [f.seller.account.address]);
			await expect(f.write(f.nextOwner, "acceptOwnership")).rejects.toThrow(
				"revert",
			);
			await f.write(f.seller, "acceptOwnership");
			expect(await f.read("owner")).toBe(f.seller.account.address);
		});

		it("pauses deposits, settlement and early close while preserving timeout refunds and all withdrawals", async () => {
			await f.open();
			await f.settle(f.owner, 2000n * f.unit, 0n);
			await f.write(f.owner, "pause");
			expect(await f.read("paused")).toBe(true);
			await expect(f.open(f.secondId)).rejects.toThrow("revert");
			await expect(f.settle(f.owner, 3000n * f.unit, 1n)).rejects.toThrow(
				"revert",
			);
			await expect(f.write(f.owner, "closeSession", [f.id])).rejects.toThrow(
				"await settlement window",
			);
			expect(await f.balance()).toBe(f.budget);
			await f.write(f.buyer, "requestClose", [f.id]);
			await f.advance(121);
			await f.write(f.nextOwner, "closeSession", [f.id]);
			expect(await f.claimable(f.buyer.account.address)).toBe(8000n * f.unit);
			for (const wallet of [f.buyer, f.seller, f.owner])
				await f.write(wallet, "withdraw");
			expect(await f.balance()).toBe(0n);
			expect(await f.read("paused")).toBe(true);
		});

		it("allows ownership recovery while paused and resumes existing sessions after unpause", async () => {
			await f.open();
			await f.write(f.owner, "pause");
			await f.write(f.owner, "transferOwnership", [
				f.nextOwner.account.address,
			]);
			await f.write(f.nextOwner, "acceptOwnership");
			await expect(f.write(f.owner, "unpause")).rejects.toThrow("revert");
			await f.write(f.nextOwner, "unpause");
			await f.settle(f.nextOwner, 2000n * f.unit, 0n);
			await f.open(f.secondId);
			expect(await f.read("paused")).toBe(false);
			expect(await f.claimable(f.nextOwner.account.address)).toBe(
				100n * f.unit,
			);
		});
	},
);
