"use client";

import { ArrowDownToLine, Plus, Wallet } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { PrepaidAccountView } from "~/shared/model-routing";
import { formatAmount, parseMicroAmount } from "~/shared/money";
import { isNativeAsset } from "~/shared/settlement-asset";
import type { NetworkInfo } from "~/shared/token2api";
import { Loading, Modal, Panel, QueryError } from "./ui";

export type PrepaidAccountProps = {
	account: PrepaidAccountView | null;
	loading: boolean;
	queryError: string | null;
	error: string | null;
	network: NetworkInfo;
	signedIn: boolean;
	busy: boolean;
	preview?: boolean;
	onRetry: () => void;
	onOpen: () => void;
	onTransfer: (
		kind: "deposit" | "withdraw",
		amount: number,
	) => Promise<boolean>;
};

export function PrepaidAccountPanel({
	account,
	loading,
	queryError,
	error,
	network,
	signedIn,
	busy,
	preview,
	onRetry,
	onOpen,
	onTransfer,
}: PrepaidAccountProps) {
	const [kind, setKind] = useState<"deposit" | "withdraw" | null>(null);
	const [amount, setAmount] = useState("");
	const [validation, setValidation] = useState<string | null>(null);
	const open = (next: "deposit" | "withdraw") => {
		onOpen();
		setAmount("");
		setValidation(null);
		setKind(next);
	};
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setValidation(null);
		try {
			const micro = parseMicroAmount(amount);
			if (!kind || micro <= 0) throw new Error("金额必须大于零。");
			if (kind === "withdraw" && account && micro > account.available)
				throw new Error("提取金额超过可用余额。");
			if (await onTransfer(kind, micro)) setKind(null);
		} catch (cause) {
			setValidation(cause instanceof Error ? cause.message : "金额无效。");
		}
	};
	return (
		<>
			<Panel
				action={<Wallet size={18} />}
				className="prepaid-account"
				subtitle={`${network.name} · ${network.asset} · 所有模型 Key 共用，创建 Key 不会分配或复制余额。`}
				title="统一预付余额"
			>
				<div className="prepaid-account-body">
					{!signedIn ? (
						<p className="muted">连接钱包并签名登录后查看预付余额。</p>
					) : preview ? (
						<p className="muted">UI 预览：未读取真实资金，不执行充值或提现。</p>
					) : loading ? (
						<Loading label="正在读取预付余额…" />
					) : queryError ? (
						<QueryError message={queryError} onRetry={onRetry} />
					) : (
						account && (
							<>
								<div className="prepaid-account-total">
									<span className="prepaid-account-caption">可用余额</span>
									<strong>
										{formatAmount(account.available, true)}{" "}
										<small>{network.asset}</small>
									</strong>
								</div>
								<div className="prepaid-account-breakdown">
									{(
										[
											["准备预留", account.preparing],
											["调用预留 / 待核对", account.reserved],
											["已计量待结算", account.pendingSettlement],
											["等待退回可用余额", account.releasing],
										] as const
									).map(([label, value]) => (
										<div key={label}>
											<span>{label}</span>
											<strong>
												{formatAmount(value, true)} {network.asset}
											</strong>
										</div>
									))}
								</div>
							</>
						)
					)}
					<div className="form-actions">
						<button
							className="button"
							disabled={
								busy ||
								!signedIn ||
								(!account && !preview) ||
								account?.available === 0
							}
							onClick={() => open("withdraw")}
							type="button"
						>
							<ArrowDownToLine size={14} />
							提取未用余额
						</button>
						<button
							className="button primary"
							disabled={busy || !signedIn || (!account && !preview)}
							onClick={() => open("deposit")}
							type="button"
						>
							<Plus size={14} />
							充值
						</button>
					</div>
					<p className="muted">
						先预留，再按平台模型报价核销。用量不明的资金继续保留，不能作为可用余额。钱包余额、商家收入与此余额分开记录。
					</p>
				</div>
			</Panel>
			{kind && (
				<Modal
					busy={busy}
					error={validation ?? error}
					onClose={() => !busy && setKind(null)}
					title={kind === "deposit" ? "充值预付余额" : "提取预付余额"}
				>
					<form onSubmit={(event) => void submit(event)}>
						<div className="notice info">
							{network.name} · {network.asset} ·{" "}
							{kind === "deposit"
								? "充值到当前钱包的统一预付账户"
								: "仅提取已确认且未预留的余额到当前钱包"}
						</div>
						<div className="field">
							<label htmlFor="prepaid-amount">金额（{network.asset}）</label>
							<input
								disabled={busy}
								id="prepaid-amount"
								inputMode="decimal"
								maxLength={24}
								onChange={(event) => setAmount(event.target.value)}
								pattern="[0-9]+([.][0-9]{1,6})?"
								placeholder="请输入金额，最多 6 位小数"
								required
								type="text"
								value={amount}
							/>
							<small>
								需要钱包确认，网络手续费另计。
								{kind === "deposit" &&
									!isNativeAsset(network.asset) &&
									"代币充值需依次确认两笔授权和一笔充值。"}
							</small>
						</div>
						<div className="form-actions">
							<button
								className="button"
								disabled={busy}
								onClick={() => setKind(null)}
								type="button"
							>
								取消
							</button>
							<button
								className="button primary"
								disabled={busy || !amount.trim()}
								type="submit"
							>
								{busy ? "等待钱包与链上确认…" : "前往钱包确认"}
							</button>
						</div>
					</form>
				</Modal>
			)}
		</>
	);
}
