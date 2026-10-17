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
import { escrowAbi, nativeEscrowAbi } from "../src/lib/abi";
import { NATIVE_TOKEN, toChainAmount } from "../src/shared/settlement-asset";

const budget = toChainAmount(1_000_000, "MON");
const digest = `0x${"ab".repeat(32)}` as Hex;
async function fixture() {
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
	const [buyer, meter, seller, treasury] = wallets;
	if (!buyer || !meter || !seller || !treasury)
		throw new Error("Missing test wallets");
	const artifact = JSON.parse(
		readFileSync("contracts/artifacts/NativeUsageEscrow.json", "utf8"),
	) as { abi: Abi; bytecode: Hex };
	const deployment = await client.waitForTransactionReceipt({
		hash: await buyer.deployContract({
			...artifact,
			args: [meter.account.address, treasury.account.address, 500],
		}),
	});
	const escrow = deployment.contractAddress;
	if (!escrow) throw new Error("Missing native escrow");
	const id =
		`0x${buyer.account.address.slice(2).toLowerCase()}${"01".repeat(12)}` as Hex;
	const open = async (value = budget, amount = budget, sessionId = id) => {
		const block = await client.getBlock();
		return buyer.writeContract({
			address: escrow,
			abi: nativeEscrowAbi,
			functionName: "openSession",
			args: [
				sessionId,
				seller.account.address,
				digest,
				amount,
				block.timestamp + 300n,
			],
			value,
		});
	};
	const settle = (amount: bigint, nonce: bigint) =>
		meter.writeContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "settle",
			args: [id, amount, nonce, digest],
		});
	const claimable = (owner: Address) =>
		client.readContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "claimable",
			args: [owner],
		});
	const close = () =>
		meter.writeContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "closeSession",
			args: [id],
		});
	return {
		provider,
		client,
		buyer,
		meter,
		seller,
		treasury,
		escrow,
		id,
		open,
		settle,
		claimable,
		close,
	};
}

describe("native MON escrow on an isolated EVM", () => {
	let f: Awaited<ReturnType<typeof fixture>>;
	let snapshot: string;
	beforeAll(async () => {
		execFileSync(process.execPath, ["scripts/compile.mjs"]);
		f = await fixture();
	}, 30_000);
	beforeEach(async () => {
		snapshot = await f.provider.request({ method: "evm_snapshot", params: [] });
	});
	afterEach(async () => {
		await f.provider.request({ method: "evm_revert", params: [snapshot] });
	});
	afterAll(async () => {
		await f?.provider.disconnect();
	});

	it("requires an exact native deposit and a consumer-owned ID", async () => {
		expect(
			await f.client.readContract({
				address: f.escrow,
				abi: escrowAbi,
				functionName: "token",
			}),
		).toBe(NATIVE_TOKEN);
		await expect(f.open(0n)).rejects.toThrow("invalid MON deposit");
		await expect(f.open(budget + 1n)).rejects.toThrow("invalid MON deposit");
		await expect(f.open(budget + 1n, budget + 1n)).rejects.toThrow(
			"invalid MON deposit",
		);
		await expect(f.open(budget, budget, digest)).rejects.toThrow(
			"session owner mismatch",
		);
		await f.open();
		expect(await f.client.getBalance({ address: f.escrow })).toBe(budget);
	});

	it("conserves deposited MON through fee allocation, refund and all withdrawals", async () => {
		await f.open();
		const spent = toChainAmount(123_457, "MON");
		await f.settle(spent, 0n);
		await f.close();
		const fee = (spent * 500n) / 10_000n;
		expect(await f.claimable(f.seller.account.address)).toBe(spent - fee);
		expect(await f.claimable(f.treasury.account.address)).toBe(fee);
		expect(await f.claimable(f.buyer.account.address)).toBe(budget - spent);
		for (const wallet of [f.buyer, f.seller, f.treasury]) {
			const before = await f.client.getBalance({
				address: wallet.account.address,
			});
			const amount = await f.claimable(wallet.account.address);
			const receipt = await f.client.waitForTransactionReceipt({
				hash: await wallet.writeContract({
					address: f.escrow,
					abi: escrowAbi,
					functionName: "withdraw",
				}),
			});
			expect(
				await f.client.getBalance({ address: wallet.account.address }),
			).toBe(before + amount - receipt.gasUsed * receipt.effectiveGasPrice);
			expect(await f.claimable(wallet.account.address)).toBe(0n);
			await expect(
				wallet.writeContract({
					address: f.escrow,
					abi: escrowAbi,
					functionName: "withdraw",
				}),
			).rejects.toThrow("nothing to withdraw");
		}
		expect(await f.client.getBalance({ address: f.escrow })).toBe(0n);
	});

	it("rejects overcharging, replay, unauthorized settlement and sub-billing precision", async () => {
		await f.open();
		await expect(
			f.settle(budget + toChainAmount(1, "MON"), 0n),
		).rejects.toThrow("invalid amount");
		await expect(f.settle(1n, 0n)).rejects.toThrow("invalid billing precision");
		await expect(
			f.seller.writeContract({
				address: f.escrow,
				abi: escrowAbi,
				functionName: "settle",
				args: [f.id, toChainAmount(1, "MON"), 0n, digest],
			}),
		).rejects.toThrow("meter only");
		await f.settle(toChainAmount(1, "MON"), 0n);
		await expect(f.settle(toChainAmount(2, "MON"), 0n)).rejects.toThrow(
			"invalid receipt",
		);
	});

	it("lets the consumer recover unused MON when the meter is unavailable", async () => {
		await f.open();
		await f.buyer.writeContract({
			address: f.escrow,
			abi: escrowAbi,
			functionName: "requestClose",
			args: [f.id],
		});
		await expect(
			f.buyer.writeContract({
				address: f.escrow,
				abi: escrowAbi,
				functionName: "closeSession",
				args: [f.id],
			}),
		).rejects.toThrow("await settlement window");
		await f.provider.request({ method: "evm_increaseTime", params: [121] });
		await f.provider.request({ method: "evm_mine", params: [] });
		await f.buyer.writeContract({
			address: f.escrow,
			abi: escrowAbi,
			functionName: "closeSession",
			args: [f.id],
		});
		expect(await f.claimable(f.buyer.account.address)).toBe(budget);
		await expect(f.settle(toChainAmount(1, "MON"), 0n)).rejects.toThrow(
			"inactive session",
		);
	});
});
