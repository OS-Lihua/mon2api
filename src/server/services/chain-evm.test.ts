import { readFileSync } from "node:fs";
import ganache from "ganache";
import {
	type Abi,
	createWalletClient,
	custom,
	type Hex,
	keccak256,
	stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { expect, it, vi } from "vitest";
import { escrowAbi, tokenAbi } from "~/lib/abi";
import {
	chainBalances,
	findSessionClose,
	findSessionOpen,
	findSettlement,
} from "./chain";

const fixture = vi.hoisted(() => ({
	transport: undefined as
		| ReturnType<typeof import("viem")["custom"]>
		| undefined,
	config: {
		mode: "evm",
		chainId: 8453,
		rpcUrl: "http://127.0.0.1:1",
		escrow: "",
		token: "",
		deploymentBlock: "0",
	},
}));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("./runtime", () => ({
	chainConfig: () => fixture.config,
	demoEnabled: () => false,
}));
vi.mock("viem", async (original) => {
	const viem = await original<typeof import("viem")>();
	return {
		...viem,
		createPublicClient: () => {
			if (!fixture.transport) throw new Error("Missing isolated EVM transport");
			return viem.createPublicClient({
				transport: fixture.transport,
				cacheTime: 0,
				pollingInterval: 10,
			});
		},
	};
});
type Artifact = {
	abi: Abi;
	bytecode: Hex;
};
it("uses real viem receipts, six blocks and a consumer force-close in an isolated in-memory EVM", async () => {
	const provider = ganache.provider({
		logging: { quiet: true },
		chain: { chainId: 31337, hardfork: "shanghai" },
		wallet: { deterministic: true, totalAccounts: 3 },
	});
	fixture.transport = custom(provider, { retryCount: 0 });
	// Import the real factory; the service factory above only replaces transport.
	const realViem = await vi.importActual<typeof import("viem")>("viem");
	const client = realViem.createPublicClient({
		transport: fixture.transport,
		cacheTime: 0,
		pollingInterval: 10,
	});
	const wallets = Object.values(provider.getInitialAccounts()).map(
		({ secretKey }) =>
			createWalletClient({
				chain: foundry,
				account: privateKeyToAccount(secretKey as Hex),
				transport: fixture.transport ?? custom(provider),
			}),
	);
	const [consumer, meter, supplier] = wallets;
	if (!consumer || !meter || !supplier) throw new Error("Missing EVM accounts");
	try {
		const tokenArtifact = JSON.parse(
			readFileSync(
				new URL("../../../contracts/artifacts/DemoUSD.json", import.meta.url),
				"utf8",
			),
		) as Artifact;
		const escrowArtifact = JSON.parse(
			readFileSync(
				new URL(
					"../../../contracts/artifacts/UsageEscrow.json",
					import.meta.url,
				),
				"utf8",
			),
		) as Artifact;
		const tokenTx = await consumer.deployContract(tokenArtifact);
		const token = (await client.waitForTransactionReceipt({ hash: tokenTx }))
			.contractAddress;
		if (!token) throw new Error("Missing token deployment");
		const escrowTx = await consumer.deployContract({
			...escrowArtifact,
			args: [token, meter.account.address, supplier.account.address, 500],
		});
		const escrow = (await client.waitForTransactionReceipt({ hash: escrowTx }))
			.contractAddress;
		if (!escrow) throw new Error("Missing escrow deployment");
		fixture.config.escrow = escrow;
		fixture.config.token = token;
		const id =
			`0x${consumer.account.address.slice(2).toLowerCase()}${"ab".repeat(12)}` as Hex;
		const digest = keccak256(stringToHex("fixed batch"));
		await consumer.writeContract({
			address: token,
			abi: tokenAbi,
			functionName: "mint",
			args: [consumer.account.address, 1000n],
		});
		const balances = await chainBalances(consumer.account.address);
		expect(balances).toEqual({ claimable: "0", walletBalance: "1000" });
		await consumer.writeContract({
			address: token,
			abi: tokenAbi,
			functionName: "approve",
			args: [escrow, 1000n],
		});
		const block = await client.getBlock();
		const openHash = await consumer.writeContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "openSession",
			args: [
				id,
				supplier.account.address,
				digest,
				1000n,
				block.timestamp + 300n,
			],
		});
		const openReceipt = await client.getTransactionReceipt({ hash: openHash });
		let activated = false;
		const openRecovery = findSessionOpen(id, openHash).then((result) => {
			activated = true;
			return result;
		});
		while ((await client.getBlockNumber()) - openReceipt.blockNumber < 4n)
			await provider.request({ method: "evm_mine", params: [] });
		expect(activated).toBe(false);
		await provider.request({ method: "evm_mine", params: [] });
		await expect(openRecovery).resolves.toMatchObject({
			receipt: { transactionHash: openHash },
			event: {
				args: {
					id,
					consumer: consumer.account.address,
					provider: supplier.account.address,
					budget: 1000n,
					termsHash: digest,
				},
			},
		});
		await expect(findSessionOpen(id, openHash)).resolves.toMatchObject({
			receipt: { transactionHash: openHash },
		});
		await expect(
			findSessionOpen(keccak256(stringToHex("missing-session"))),
		).resolves.toBeNull();
		const txHash = await meter.writeContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "settle",
			args: [id, 200n, 0n, digest],
		});
		const settlementReceipt = await client.getTransactionReceipt({
			hash: txHash,
		});
		let complete = false;
		const recovery = findSettlement(id, 0, digest, 200).then((hash) => {
			complete = true;
			return hash;
		});
		// Five additional blocks make the inclusion block six confirmations deep.
		while ((await client.getBlockNumber()) - settlementReceipt.blockNumber < 4n)
			await provider.request({ method: "evm_mine", params: [] });
		expect(complete).toBe(false);
		await provider.request({ method: "evm_mine", params: [] });
		await expect(recovery).resolves.toBe(txHash);
		await expect(findSettlement(id, 0, digest, 201)).resolves.toBeNull();
		await consumer.writeContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "requestClose",
			args: [id],
		});
		await provider.request({ method: "evm_increaseTime", params: [121] });
		await provider.request({ method: "evm_mine", params: [] });
		const closeHash = await consumer.writeContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "closeSession",
			args: [id],
		});
		for (let index = 0; index < 5; index++)
			await provider.request({ method: "evm_mine", params: [] });
		await expect(findSessionClose(id)).resolves.toMatchObject({
			txHash: closeHash,
			state: { closed: true, spent: 200, nonce: 1, budget: 1000 },
		});
		// A closed session still exposes and validates the original paid receipt.
		await expect(findSettlement(id, 0, digest, 200)).resolves.toBe(txHash);
	} finally {
		await provider.disconnect();
		fixture.transport = undefined;
	}
}, 20000);

it("prevents a funded wallet from claiming another consumer's session ID", async () => {
	const provider = ganache.provider({
		logging: { quiet: true },
		chain: { chainId: 31337, hardfork: "shanghai" },
		wallet: { deterministic: true, totalAccounts: 3 },
	});
	fixture.transport = custom(provider, { retryCount: 0 });
	const realViem = await vi.importActual<typeof import("viem")>("viem");
	const client = realViem.createPublicClient({ transport: fixture.transport });
	const wallets = Object.values(provider.getInitialAccounts()).map(
		({ secretKey }) =>
			createWalletClient({
				chain: foundry,
				account: privateKeyToAccount(secretKey as Hex),
				transport: fixture.transport ?? custom(provider),
			}),
	);
	const [consumer, , attacker] = wallets;
	if (!consumer || !attacker) throw new Error("Missing EVM accounts");
	try {
		const tokenArtifact = JSON.parse(
			readFileSync(
				new URL("../../../contracts/artifacts/DemoUSD.json", import.meta.url),
				"utf8",
			),
		) as Artifact;
		const escrowArtifact = JSON.parse(
			readFileSync(
				new URL(
					"../../../contracts/artifacts/UsageEscrow.json",
					import.meta.url,
				),
				"utf8",
			),
		) as Artifact;
		const tokenTx = await consumer.deployContract(tokenArtifact);
		const token = (await client.waitForTransactionReceipt({ hash: tokenTx }))
			.contractAddress;
		if (!token) throw new Error("Missing token deployment");
		const escrowTx = await consumer.deployContract({
			...escrowArtifact,
			args: [token, consumer.account.address, attacker.account.address, 500],
		});
		const escrow = (await client.waitForTransactionReceipt({ hash: escrowTx }))
			.contractAddress;
		if (!escrow) throw new Error("Missing escrow deployment");
		const id =
			`0x${consumer.account.address.slice(2).toLowerCase()}${"ab".repeat(12)}` as Hex;
		const digest = keccak256(stringToHex("same draft terms"));
		const expiresAt = (await client.getBlock()).timestamp + 300n;
		for (const wallet of [consumer, attacker]) {
			await wallet.writeContract({
				address: token,
				abi: tokenAbi,
				functionName: "mint",
				args: [wallet.account.address, 100n],
			});
			await wallet.writeContract({
				address: token,
				abi: tokenAbi,
				functionName: "approve",
				args: [escrow, 100n],
			});
		}
		// This caller can pay and has approved the escrow; the ID check must stop them.
		await expect(
			client.simulateContract({
				account: attacker.account,
				address: escrow,
				abi: escrowAbi,
				functionName: "openSession",
				args: [id, attacker.account.address, digest, 100n, expiresAt],
			}),
		).rejects.toThrow();
		const empty = await client.readContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "sessions",
			args: [id],
		});
		expect(empty[0]).toBe("0x0000000000000000000000000000000000000000");
		const openHash = await consumer.writeContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "openSession",
			args: [id, attacker.account.address, digest, 100n, expiresAt],
		});
		expect(
			(await client.waitForTransactionReceipt({ hash: openHash })).status,
		).toBe("success");
		const session = await client.readContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "sessions",
			args: [id],
		});
		expect(session[0]).toBe(consumer.account.address);
	} finally {
		await provider.disconnect();
		fixture.transport = undefined;
	}
}, 20000);
