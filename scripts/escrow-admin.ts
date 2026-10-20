import "dotenv/config";
import { type Address, getAddress, type Hex, zeroAddress } from "viem";
import { z } from "zod";
import { escrowAbi, nativeEscrowAbi } from "../src/lib/abi";
import { clients, ownerWallet } from "../src/server/services/chain";
import { assetOf, isNativeAsset } from "../src/shared/settlement-asset";

const commands = [
	"status",
	"pause",
	"unpause",
	"transfer",
	"cancel-transfer",
	"accept",
	"withdraw",
] as const;
const command = z.enum(commands).parse(process.argv[2] ?? "status");
const arguments_ = process.argv.slice(3);
const addressInput = z
	.string()
	.regex(/^0x[\da-fA-F]{40}$/)
	.transform((value) => getAddress(value));

async function main() {
	const { config, publicClient } = clients();
	const address = getAddress(config.escrow);
	if (command === "status") {
		z.tuple([]).parse(arguments_);
		const [owner, pendingOwner, paused] = await Promise.all([
			publicClient.readContract({
				address,
				abi: escrowAbi,
				functionName: "owner",
			}),
			publicClient.readContract({
				address,
				abi: escrowAbi,
				functionName: "pendingOwner",
			}),
			publicClient.readContract({
				address,
				abi: escrowAbi,
				functionName: "paused",
			}),
		]);
		const claimable = await publicClient.readContract({
			address,
			abi: escrowAbi,
			functionName: "claimable",
			args: [owner],
		});
		console.log(
			JSON.stringify(
				{
					escrow: address,
					owner,
					pendingOwner,
					paused,
					claimable: claimable.toString(),
				},
				null,
				2,
			),
		);
		return;
	}
	let recipient: Address | undefined;
	if (command === "transfer") {
		[recipient] = z
			.tuple([
				addressInput.refine(
					(value) => value !== zeroAddress,
					"New owner cannot be zero.",
				),
			])
			.parse(arguments_);
	} else if (command === "withdraw") {
		[recipient] = z.array(addressInput).max(1).parse(arguments_);
	} else {
		z.tuple([]).parse(arguments_);
	}
	const wallet = await ownerWallet(
		command !== "accept" && command !== "withdraw",
	);
	let hash: Hex;
	if (command === "transfer" || command === "cancel-transfer") {
		hash = await wallet.writeContract({
			address,
			abi: escrowAbi,
			functionName: "transferOwnership",
			args: [recipient ?? zeroAddress],
		});
	} else if (command === "withdraw" && recipient) {
		if (!isNativeAsset(assetOf(config)))
			throw new Error(
				"A custom recipient is supported only for native withdrawals.",
			);
		if (recipient === zeroAddress || recipient === address)
			throw new Error("Invalid withdrawal recipient.");
		hash = await wallet.writeContract({
			address,
			abi: nativeEscrowAbi,
			functionName: "withdrawTo",
			args: [recipient],
		});
	} else {
		hash = await wallet.writeContract({
			address,
			abi: escrowAbi,
			functionName: command === "accept" ? "acceptOwnership" : command,
		});
	}
	// Print the hash before waiting, so an interrupted CLI can recover the receipt.
	console.log(`Transaction submitted: ${hash}`);
	const receipt = await publicClient.waitForTransactionReceipt({
		hash,
		confirmations: config.mode === "local" ? 1 : 6,
	});
	if (receipt.status !== "success")
		throw new Error("Escrow administration transaction reverted.");
	console.log(`Confirmed ${command}: ${hash}`);
}

main().catch((error: unknown) => {
	console.error(
		error instanceof Error ? error.message : "Escrow administration failed.",
	);
	process.exitCode = 1;
});
