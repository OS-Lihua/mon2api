import { encodeFunctionData } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
	type ChainContext,
	sendPrepaidTransfer,
} from "~/app/_components/console/chain-actions";
import { tokenAbi } from "~/lib/abi";
import { prepaidAbi } from "~/lib/prepaid-abi";
import { NATIVE_TOKEN, toChainAmount } from "~/shared/settlement-asset";
import type { NetworkInfo } from "~/shared/token2api";

const address = "0x1111111111111111111111111111111111111111";
const escrow = "0x2222222222222222222222222222222222222222";
const token = "0x3333333333333333333333333333333333333333";
const network: NetworkInfo = {
	asset: "USDC",
	tokenDecimals: 6,
	mode: "local",
	chainId: 31337,
	ledgerUnit: "micro_USDC",
	balanceUnit: "atomic",
	name: "Local EVM",
	rpcUrl: "http://127.0.0.1:8545",
	escrow,
	token,
	feeBps: 500,
	ready: true,
	explorer: "",
};
function fixture(native = false, kind: "deposit" | "withdraw" = "deposit") {
	const current = native
		? {
				...network,
				asset: "ETH" as const,
				token: NATIVE_TOKEN,
				tokenDecimals: 18,
			}
		: network;
	const amount = toChainAmount(1_000_000, current.asset, current.tokenDecimals);
	const transactions = [];
	if (!native && kind === "deposit")
		for (const allowance of [0n, amount])
			transactions.push({
				to: token,
				value: "0",
				data: encodeFunctionData({
					abi: tokenAbi,
					functionName: "approve",
					args: [escrow, allowance],
				}),
			});
	transactions.push({
		to: escrow,
		value: native && kind === "deposit" ? amount.toString() : "0",
		data: encodeFunctionData({
			abi: prepaidAbi,
			functionName: kind === "deposit" ? "depositPrepaid" : "withdrawPrepaid",
			args: [amount],
		}),
	});
	const getWallet = vi
		.fn<ChainContext["getWallet"]>()
		.mockRejectedValue(new Error("wallet requested"));
	const context: ChainContext = {
		network: current,
		address,
		getWallet,
		isCurrent: () => true,
	};
	return {
		context,
		plan: { chainId: 31337, amount: 1_000_000, transactions },
		getWallet,
	};
}
describe("wallet-signed prepaid transaction boundary", () => {
	it.each([
		[false, "deposit"],
		[true, "deposit"],
		[false, "withdraw"],
		[true, "withdraw"],
	] as const)("accepts only the exact %s / %s plan", async (native, kind) => {
		const { context, plan, getWallet } = fixture(native, kind);
		await expect(
			sendPrepaidTransfer(context, plan, plan.amount, kind),
		).rejects.toThrow("wallet requested");
		expect(getWallet).toHaveBeenCalledWith(context.network, address);
	});
	it.each([
		"chain",
		"amount",
		"target",
		"spender",
		"allowance",
		"method",
		"value",
		"order",
		"extra",
		"missing",
		"native-target",
	])("rejects a modified %s before any signature", async (tamper) => {
		const { context, plan, getWallet } = fixture(tamper === "native-target");
		const first = plan.transactions[0];
		const last = plan.transactions.at(-1);
		if (!first || !last) throw new Error("Missing fixture transaction");
		if (tamper === "chain") plan.chainId = 1;
		if (tamper === "amount") plan.amount += 1;
		if (tamper === "target") first.to = address;
		if (tamper === "native-target") first.to = NATIVE_TOKEN;
		if (tamper === "spender")
			first.data = encodeFunctionData({
				abi: tokenAbi,
				functionName: "approve",
				args: [address, 0n],
			});
		if (tamper === "allowance")
			first.data = encodeFunctionData({
				abi: tokenAbi,
				functionName: "approve",
				args: [escrow, 2n ** 256n - 1n],
			});
		if (tamper === "method")
			last.data = encodeFunctionData({
				abi: prepaidAbi,
				functionName: "withdrawPrepaid",
				args: [1_000_000n],
			});
		if (tamper === "value") last.value = "1";
		if (tamper === "order") plan.transactions.reverse();
		if (tamper === "extra") plan.transactions.push({ ...last });
		if (tamper === "missing") plan.transactions.shift();
		await expect(
			sendPrepaidTransfer(context, plan, 1_000_000, "deposit"),
		).rejects.not.toThrow("wallet requested");
		expect(getWallet).not.toHaveBeenCalled();
	});
});
