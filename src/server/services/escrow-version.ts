import {
	type Address,
	type createPublicClient,
	encodeFunctionData,
} from "viem";
import { escrowAbi } from "~/lib/abi";

const zeroAddress = "0x0000000000000000000000000000000000000000";
const zeroHash = `0x${"00".repeat(32)}` as const;
const wrongOwnerId = `0x${"00".repeat(32)}` as const;
const ownerGuardReason = "session owner mismatch";

function hasRevertReason(error: unknown, reason: string) {
	const seen = new Set<unknown>();
	let cause = error;
	while (cause instanceof Error && !seen.has(cause)) {
		if (cause.message.includes(reason)) return true;
		seen.add(cause);
		cause = cause.cause;
	}
	return false;
}

/** Fail closed unless the deployed escrow enforces session ownership. */
export async function assertEscrowOwnerGuard(
	client: Pick<ReturnType<typeof createPublicClient>, "call">,
	escrow: Address,
	caller: Address,
) {
	if (caller.toLowerCase() === zeroAddress)
		throw new Error("A nonzero caller is required to verify the escrow.");
	try {
		await client.call({
			to: escrow,
			account: caller,
			data: encodeFunctionData({
				abi: escrowAbi,
				functionName: "openSession",
				args: [wrongOwnerId, zeroAddress, zeroHash, 0n, 0n],
			}),
		});
	} catch (error) {
		if (hasRevertReason(error, ownerGuardReason)) return;
		throw new Error("Escrow session ownership guard could not be verified.", {
			cause: error,
		});
	}
	throw new Error("Escrow session ownership guard is absent.");
}
