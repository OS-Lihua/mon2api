import { getAddress, isAddress, isHex, zeroAddress } from "viem";
import { z } from "zod";
import { escrowAbi, nativeEscrowAbi, tokenAbi } from "~/lib/abi";
import type { getConnectedWallet } from "~/lib/wallet";
import { isNativeAsset, toChainAmount } from "~/shared/settlement-asset";
import type { NetworkInfo, OpenSessionResult } from "~/shared/token2api";

/** Thrown when the signed-in identity changed during a wallet flow; callers drop it silently. */
export class StaleIdentityError extends Error {
	constructor() {
		super("登录身份已变化，操作已停止。");
	}
}

export type ChainContext = {
	getWallet: (
		network: NetworkInfo,
		expectedAddress?: string,
	) => ReturnType<typeof getConnectedWallet>;
	network: NetworkInfo;
	address: string;
	isCurrent: () => boolean;
};

function guard(isCurrent: () => boolean) {
	if (!isCurrent()) throw new StaleIdentityError();
}

/**
 * Locks a lease budget in escrow. Every signature re-reads the wallet so an
 * account or chain switch between approval and lock aborts the flow.
 */
export async function lockBudget(
	{ getWallet, network, address, isCurrent }: ChainContext,
	transaction: OpenSessionResult["transaction"],
) {
	const { account } = await getWallet(network, address);
	guard(isCurrent);
	if (account.toLowerCase() !== address.toLowerCase())
		throw new Error("当前钱包与登录地址不同，请重新连接钱包。");
	const verifiedWallet = await getWallet(network, address);
	guard(isCurrent);
	const { id, termsHash } = transaction;
	if (!isHex(id) || !isHex(termsHash)) throw new Error("会话交易参数无效。");
	const chainBudget = toChainAmount(
		transaction.budget,
		network.asset,
		network.tokenDecimals,
	);
	const escrow = getAddress(network.escrow);
	if (!isNativeAsset(network.asset)) {
		// Reset first for tokens that require zero allowance before replacement (USDT).
		for (const allowance of [0n, chainBudget]) {
			const approvalWallet = await getWallet(network, address);
			guard(isCurrent);
			const approval = await approvalWallet.wallet.writeContract({
				account: approvalWallet.account,
				address: getAddress(network.token),
				abi: tokenAbi,
				functionName: "approve",
				args: [escrow, allowance],
			});
			const receipt =
				await approvalWallet.publicClient.waitForTransactionReceipt({
					hash: approval,
				});
			if (receipt.status !== "success") throw new Error("代币授权交易失败。");
			guard(isCurrent);
			await getWallet(network, address);
		}
	}
	const currentWallet = await getWallet(network, address);
	guard(isCurrent);
	const args = [
		id,
		getAddress(transaction.provider),
		termsHash,
		chainBudget,
		BigInt(transaction.expiresAt),
	] as const;
	const hash = isNativeAsset(network.asset)
		? await currentWallet.wallet.writeContract({
				account: currentWallet.account,
				address: escrow,
				abi: nativeEscrowAbi,
				functionName: "openSession",
				value: chainBudget,
				args,
			})
		: await currentWallet.wallet.writeContract({
				account: currentWallet.account,
				address: escrow,
				abi: escrowAbi,
				functionName: "openSession",
				args,
			});
	const receipt = await verifiedWallet.publicClient.waitForTransactionReceipt({
		hash,
	});
	if (receipt.status !== "success") throw new Error("预算锁定交易失败。");
	guard(isCurrent);
	return hash;
}

const withdrawalRecipient = z.string().trim().refine(isAddress);

export async function withdrawBalance(
	{ getWallet, network, address, isCurrent }: ChainContext,
	recipientInput?: string,
) {
	const native = isNativeAsset(network.asset);
	if (!native && recipientInput !== undefined)
		throw new Error("自定义收款地址仅支持原生币提现。");
	const parsed = withdrawalRecipient.safeParse(recipientInput ?? address);
	if (!parsed.success || parsed.data === zeroAddress)
		throw new Error("请填写有效的非零收款地址。");
	const recipient = getAddress(parsed.data);
	const escrow = getAddress(network.escrow);
	if (recipient === escrow) throw new Error("收款地址不能是托管合约。");
	const { wallet, account, publicClient } = await getWallet(network, address);
	guard(isCurrent);
	if (account.toLowerCase() !== address.toLowerCase())
		throw new Error("钱包地址与登录身份不一致。");
	const hash =
		native && recipient !== getAddress(account)
			? await wallet.writeContract({
					account,
					address: escrow,
					abi: nativeEscrowAbi,
					functionName: "withdrawTo",
					args: [recipient],
				})
			: await wallet.writeContract({
					account,
					address: escrow,
					abi: escrowAbi,
					functionName: "withdraw",
				});
	const receipt = await publicClient.waitForTransactionReceipt({ hash });
	if (receipt.status !== "success") throw new Error("提现交易失败。");
	guard(isCurrent);
}

/**
 * Consumer exit that bypasses the platform: request close, wait for the
 * contract settlement window, then close. Returns the notice for the next step.
 */
export async function selfCloseSession(
	{ getWallet, network, address, isCurrent }: ChainContext,
	sessionId: string,
) {
	const { account, publicClient } = await getWallet(network, address);
	guard(isCurrent);
	if (account.toLowerCase() !== address.toLowerCase())
		throw new Error("钱包地址与登录身份不一致。");
	if (!isHex(sessionId)) throw new Error("会话标识无效。");
	const escrow = getAddress(network.escrow);
	const chainSession = await publicClient.readContract({
		address: escrow,
		abi: escrowAbi,
		functionName: "sessions",
		args: [sessionId],
	});
	guard(isCurrent);
	if (chainSession[8])
		return "链上会话已关闭。未使用预算已转入可提现余额，可点击提取余额取回。";
	const closeAfter = chainSession[7];
	const send = async (functionName: "requestClose" | "closeSession") => {
		const verifiedWallet = await getWallet(network, address);
		guard(isCurrent);
		const hash = await verifiedWallet.wallet.writeContract({
			account: verifiedWallet.account,
			address: escrow,
			abi: escrowAbi,
			functionName,
			args: [sessionId],
		});
		return publicClient.waitForTransactionReceipt({ hash });
	};
	if (closeAfter === 0n) {
		const receipt = await send("requestClose");
		if (receipt.status !== "success") throw new Error("自助关闭申请失败。");
		guard(isCurrent);
		return "已直接向合约申请关闭。请等待 120 秒结算窗口，再次点击钱包自助退出，关闭后可提取剩余预算。";
	}
	const block = await publicClient.getBlock();
	guard(isCurrent);
	if (block.timestamp < closeAfter)
		return `结算窗口尚未结束。约 ${Number(closeAfter - block.timestamp)} 秒后，再次点击钱包自助退出。`;
	const receipt = await send("closeSession");
	if (receipt.status !== "success") throw new Error("链上会话关闭失败。");
	guard(isCurrent);
	return "链上会话已关闭。剩余预算已转入可提现余额，请点击提取余额。";
}
