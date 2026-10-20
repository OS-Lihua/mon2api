import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import ganache from "ganache";
import {
	type Abi,
	createPublicClient,
	createWalletClient,
	type Hex,
	http,
	zeroAddress,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { expect, it } from "vitest";
import { escrowAbi, nativeEscrowAbi } from "../src/lib/abi";

const execute = promisify(execFile);

it("operates the single-wallet CLI through handover and fee withdrawal without a database", async () => {
	const mnemonic =
		"test test test test test test test test test test test junk";
	const account = (index: number) =>
		mnemonicToAccount(mnemonic, { addressIndex: index });
	const server = ganache.server({
		logging: { quiet: true },
		chain: { chainId: 31337, hardfork: "shanghai" },
		wallet: { mnemonic, totalAccounts: 6 },
	});
	await server.listen(0, "127.0.0.1");
	try {
		await execute(process.execPath, ["scripts/compile.mjs"]);
		const listening = server.address();
		if (!listening || typeof listening === "string")
			throw new Error("Missing test RPC");
		const rpcUrl = `http://127.0.0.1:${listening.port}`;
		const client = createPublicClient({
			chain: foundry,
			transport: http(rpcUrl),
			cacheTime: 0,
			pollingInterval: 10,
		});
		const wallet = (index: number) =>
			createWalletClient({
				chain: foundry,
				transport: http(rpcUrl),
				account: account(index),
			});
		const keys = server.provider.getInitialAccounts();
		const key = (index: number) => {
			const initial = keys[account(index).address.toLowerCase()];
			if (!initial) throw new Error("Missing public test key");
			return initial.secretKey;
		};
		// The artifact is compiled from the current repository immediately above.
		const compiled = JSON.parse(
			readFileSync("contracts/artifacts/NativeUsageEscrow.json", "utf8"),
		) as { abi: Abi; bytecode: Hex };
		const deployment = await client.waitForTransactionReceipt({
			hash: await wallet(4).deployContract({
				...compiled,
				args: [account(4).address, 500],
			}),
		});
		const escrow = deployment.contractAddress;
		if (!escrow) throw new Error("Missing test escrow");
		const config = {
			mode: "local",
			asset: "ETH",
			chainId: 31337,
			tokenDecimals: 18,
			rpcUrl,
			token: zeroAddress,
			escrow,
			deploymentBlock: deployment.blockNumber.toString(),
		};
		const admin = async (args: string[], index?: number) =>
			execute(
				process.execPath,
				[
					"--conditions=react-server",
					"--import",
					"tsx",
					"scripts/escrow-admin.ts",
					...args,
				],
				{
					env: {
						...process.env,
						TOKEN2API_MODE: "local",
						CHAIN_CONFIG_JSON: JSON.stringify(config),
						ESCROW_OWNER_PRIVATE_KEY: index === undefined ? "" : key(index),
						// This endpoint has no database. Administration must use RPC only.
						DATABASE_URL: "postgresql://audit:audit@127.0.0.1:1/unused",
					},
				},
			);
		const state = async () =>
			JSON.parse((await admin(["status"])).stdout) as {
				owner: string;
				pendingOwner: string;
				paused: boolean;
			};
		const readCredit = (index: number) =>
			client.readContract({
				address: escrow,
				abi: escrowAbi,
				functionName: "claimable",
				args: [account(index).address],
			});
		expect(await state()).toMatchObject({
			owner: account(4).address,
			paused: false,
		});
		const id = `0x${account(0).address.slice(2)}${"01".repeat(12)}` as Hex;
		const digest = `0x${"ab".repeat(32)}` as Hex;
		await wallet(0).writeContract({
			address: escrow,
			abi: nativeEscrowAbi,
			functionName: "openSession",
			args: [
				id,
				account(1).address,
				digest,
				10n ** 18n,
				(await client.getBlock()).timestamp + 3600n,
			],
			value: 10n ** 18n,
		});
		await wallet(4).writeContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "settle",
			args: [id, 2n * 10n ** 17n, 0n, digest],
		});
		await admin(["pause"], 4);
		expect(await state()).toMatchObject({ paused: true });
		await expect(admin(["unpause"], 5)).rejects.toThrow(
			"not the current escrow owner",
		);
		await admin(["transfer", account(5).address], 4);
		expect(await state()).toMatchObject({
			owner: account(4).address,
			pendingOwner: account(5).address,
		});
		await admin(["accept"], 5);
		await expect(admin(["unpause"], 4)).rejects.toThrow(
			"not the current escrow owner",
		);
		await admin(["unpause"], 5);
		expect(await state()).toMatchObject({
			owner: account(5).address,
			pendingOwner: zeroAddress,
			paused: false,
		});
		await wallet(5).writeContract({
			address: escrow,
			abi: escrowAbi,
			functionName: "settle",
			args: [id, 4n * 10n ** 17n, 1n, digest],
		});
		expect(await readCredit(4)).toBe(10n ** 16n);
		expect(await readCredit(5)).toBe(10n ** 16n);
		await admin(["withdraw"], 4);
		expect(await readCredit(4)).toBe(0n);
		const before = await client.getBalance({ address: account(0).address });
		await admin(["withdraw", account(0).address], 5);
		expect(await readCredit(5)).toBe(0n);
		expect(await client.getBalance({ address: account(0).address })).toBe(
			before + 10n ** 16n,
		);
	} finally {
		await server.close();
	}
}, 60_000);
