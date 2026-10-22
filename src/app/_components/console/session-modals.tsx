"use client";

import { type FormEvent, useState } from "react";
import type { ModelView } from "~/shared/model-routing";
import { formatChainBalance, formatAmount as usd } from "~/shared/money";
import type { NetworkInfo, RefundView, SessionView } from "~/shared/token2api";
import { remainingBudget } from "./format";
import { ModelPicker } from "./model-picker";
import { Modal, Transaction } from "./ui";

export function RefundModal({
	session,
	refund,
	network,
	nativeSymbol,
	claimable,
	busy,
	error,
	onClose,
	onRequest,
	onWithdraw,
}: {
	session: SessionView;
	refund: RefundView | null;
	network: NetworkInfo;
	nativeSymbol: string;
	claimable: string | null;
	busy: string | null;
	error: string | null;
	onClose: () => void;
	onRequest: () => void;
	onWithdraw: () => void;
}) {
	const asset = network.asset;
	const prepaid =
		refund?.destination === "prepaid" || session.fundingSource === "PREPAID";
	return (
		<Modal
			busy={!!busy}
			error={error}
			onClose={() => !busy && onClose()}
			title={`退回未使用的 ${asset}`}
		>
			<div className="panel-body">
				<p>
					{session.listingName} · {session.model}
				</p>
				<p>
					{refund?.status === "AVAILABLE"
						? prepaid
							? "已退回预付账户："
							: "已转入可提现余额："
						: "当前可退额度（待确认）："}
					<strong>
						{usd(refund?.amount ?? remainingBudget(session), true)} {asset}
					</strong>
				</p>
				<p>
					{prepaid
						? "本次未使用的预留退回统一预付账户，Key 可继续调用。"
						: "申请后停止此会话的新调用。"}
					退款仍使用 {asset}，提取时的网络手续费使用 {nativeSymbol}
					。已消费费用和网络手续费不退；待核对用量继续保留预留。
				</p>
				{(refund?.reserved ?? session.reserved) > 0 && (
					<p className="pending-amount">
						继续预留：{usd(refund?.reserved ?? session.reserved, true)} {asset}
						。这部分金额需核对用量后才能确定是否可退。
					</p>
				)}
				{refund && (
					<div className="notice info">
						{refund.status === "AVAILABLE"
							? prepaid
								? "未使用金额已退回预付账户，可继续调用，或在预付账户中提取到钱包。"
								: "退款已转入可提现余额，请用钱包提取。若此前已提取，无需重复操作。"
							: refund.status === "PENDING_REVIEW"
								? "申请已保存，正在等待用量核对。预留预算不会被当作零消费释放。"
								: "申请已保存，后台正在结算并关闭会话。"}
					</div>
				)}
				{refund?.txHash && (
					<Transaction hash={refund.txHash} network={network} />
				)}
				<div className="form-actions">
					<button
						className="button"
						disabled={!!busy}
						onClick={onClose}
						type="button"
					>
						返回
					</button>
					{refund?.status === "AVAILABLE" ? (
						prepaid ? null : (
							<button
								className="button primary"
								disabled={!!busy || !claimable || claimable === "0"}
								onClick={onWithdraw}
								type="button"
							>
								提取可提现 {asset} 到钱包
							</button>
						)
					) : (
						<button
							className="button primary"
							disabled={!!busy || !!refund}
							onClick={onRequest}
							type="button"
						>
							{busy === "refund" ? "正在处理…" : "确认申请退款"}
						</button>
					)}
				</div>
				{refund?.status === "AVAILABLE" && !prepaid && (
					<p className="code-hint">
						提现会提取当前钱包的全部可提现余额，可能同时包含其他会话退款或商家收入。
					</p>
				)}
			</div>
		</Modal>
	);
}

export function WithdrawModal({
	address,
	network,
	claimable,
	busy,
	error,
	onClose,
	onSubmit,
}: {
	address: string;
	network: NetworkInfo;
	claimable: string | null;
	busy: string | null;
	error: string | null;
	onClose: () => void;
	onSubmit: (recipient: string) => void;
}) {
	const [recipient, setRecipient] = useState(address);
	return (
		<Modal
			busy={!!busy}
			error={error}
			onClose={() => !busy && onClose()}
			title={`提取 ${network.asset}`}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit(recipient);
				}}
			>
				<div className="withdraw-summary">
					<span className="field-label">提取全部可提现余额</span>
					<div className="stat-value">
						{claimable === null
							? "暂不可用"
							: formatChainBalance(
									claimable,
									network.asset,
									network.tokenDecimals,
								)}
						{claimable !== null && <small>{network.asset}</small>}
					</div>
					<p className="code-hint">结算网络：{network.name}</p>
				</div>
				<div className="field">
					<label htmlFor="withdraw-recipient">收款地址</label>
					<input
						autoComplete="off"
						disabled={!!busy}
						id="withdraw-recipient"
						onChange={(event) => setRecipient(event.target.value)}
						pattern="0x[0-9a-fA-F]{40}"
						placeholder="0x…"
						required
						spellCheck={false}
						title="请输入完整的 0x 开头的 40 位十六进制地址"
						value={recipient}
					/>
					<small>
						提取当前钱包的全部可提现余额，可能包含退款和商家收入。收款地址须在当前网络支持接收{" "}
						{network.asset}，网络手续费由当前钱包支付。
					</small>
				</div>
				<div className="form-actions">
					<button
						className="button"
						disabled={!!busy}
						onClick={onClose}
						type="button"
					>
						取消
					</button>
					<button
						className="button primary"
						disabled={
							!!busy || !recipient.trim() || !claimable || claimable === "0"
						}
						type="submit"
					>
						{busy === "withdraw" ? "正在提取…" : "确认提现"}
					</button>
				</div>
			</form>
		</Modal>
	);
}

export function KeyModal({
	models,
	selectedModels,
	keyName,
	asset,
	busy,
	error,
	loading,
	queryError,
	onRetry,
	onClose,
	onKeyNameChange,
	onModelsChange,
	onSubmit,
}: {
	models: ModelView[];
	selectedModels: string[];
	keyName: string;
	asset: NetworkInfo["asset"];
	busy: string | null;
	error: string | null;
	loading: boolean;
	queryError: string | null;
	onRetry: () => void;
	onClose: () => void;
	onKeyNameChange: (value: string) => void;
	onModelsChange: (models: string[]) => void;
	onSubmit: (event: FormEvent) => void;
}) {
	return (
		<Modal
			busy={!!busy}
			error={error}
			onClose={() => !busy && onClose()}
			title="创建 API 密钥"
		>
			<form onSubmit={onSubmit}>
				<div className="field">
					<label htmlFor="key-name">密钥名称</label>
					<input
						disabled={!!busy}
						id="key-name"
						maxLength={64}
						onChange={(event) => onKeyNameChange(event.target.value)}
						required
						value={keyName}
					/>
				</div>
				<ModelPicker
					asset={asset}
					disabled={!!busy}
					error={queryError}
					loading={loading}
					models={models}
					onChange={onModelsChange}
					onRetry={onRetry}
					selected={selectedModels}
				/>
				<p className="muted">
					Key
					仅控制模型权限。调用费用从当前钱包的统一预付余额扣除，无需绑定供应商或预算会话。
				</p>
				<div className="form-actions">
					<button
						className="button"
						disabled={!!busy}
						onClick={onClose}
						type="button"
					>
						取消
					</button>
					<button
						className="button primary"
						disabled={
							!!busy ||
							!selectedModels.length ||
							!keyName.trim() ||
							loading ||
							!!queryError
						}
						type="submit"
					>
						{busy === "key" ? "正在创建…" : "创建密钥"}
					</button>
				</div>
			</form>
		</Modal>
	);
}
