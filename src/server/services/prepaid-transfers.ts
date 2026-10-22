import "server-only";
import { encodeFunctionData, getAddress } from "viem";
import type { z } from "zod";
import { tokenAbi } from "~/lib/abi";
import { prepaidAbi } from "~/lib/prepaid-abi";
import type { prepaidTransferInput } from "~/shared/model-routing";
import {
	assetOf,
	decimalsOf,
	isNativeAsset,
	toChainAmount,
} from "~/shared/settlement-asset";
import type { Viewer } from "~/shared/token2api";
import { AppError } from "./auth";
import { prepaidAccount } from "./model-routing";
import { chainConfig } from "./runtime";

/** Only constructs transactions. Every approval, deposit and withdrawal is wallet-signed. */
export async function preparePrepaidTransfer(
	user: Viewer,
	input: z.infer<typeof prepaidTransferInput>,
) {
	const account = await prepaidAccount(user);
	if (input.kind === "withdraw" && input.amount > account.available)
		throw new AppError(
			"insufficient_balance",
			"仅可提取已确认且未预留的预付余额。",
			402,
		);
	const config = chainConfig();
	const amount = toChainAmount(
		input.amount,
		assetOf(config),
		decimalsOf(config),
	);
	const escrow = getAddress(config.escrow);
	const transactions: { to: string; data: string; value: string }[] = [];
	if (input.kind === "deposit" && !isNativeAsset(assetOf(config))) {
		for (const approval of [0n, amount])
			transactions.push({
				to: getAddress(config.token),
				data: encodeFunctionData({
					abi: tokenAbi,
					functionName: "approve",
					args: [escrow, approval],
				}),
				value: "0",
			});
	}
	transactions.push({
		to: escrow,
		data: encodeFunctionData({
			abi: prepaidAbi,
			functionName:
				input.kind === "deposit" ? "depositPrepaid" : "withdrawPrepaid",
			args: [amount],
		}),
		value:
			input.kind === "deposit" && isNativeAsset(assetOf(config))
				? amount.toString()
				: "0",
	});
	return { chainId: config.chainId, amount: input.amount, transactions };
}
