"use client";

import { KeyRound, LoaderCircle, Wallet } from "lucide-react";
import type { FormEvent } from "react";
import { ConsoleSelect } from "~/app/_components/console-select";
import { isNativeAsset } from "~/shared/settlement-asset";
import type {
	ListingView,
	NetworkInfo,
	RefundView,
	SessionView,
} from "~/shared/token2api";
import { uiPreview } from "~/shared/ui-preview";
import { assetFormatter, remainingBudget, short } from "./format";
import { Modal, Transaction } from "./ui";

export function RentModal({
	listing,
	network,
	nativeSymbol,
	budget,
	busy,
	error,
	onBudgetChange,
	onClose,
	onSubmit,
}: {
	listing: ListingView;
	network: NetworkInfo;
	nativeSymbol: string;
	budget: string;
	busy: string | null;
	error: string | null;
	onBudgetChange: (value: string) => void;
	onClose: () => void;
	onSubmit: (event: FormEvent) => void;
}) {
	const asset = network.asset;
	const usd = assetFormatter(asset);
	return (
		<Modal
			error={error}
			onClose={() => !busy && onClose()}
			title="创建预算会话"
		>
			<form onSubmit={onSubmit}>
				<div className="rent-summary">
					<strong>{listing.name}</strong>
					<span className="rent-model mono">{listing.model}</span>
					<dl>
						<div>
							<dt>结算网络</dt>
							<dd>{network.name}</dd>
						</div>
						<div>
							<dt>结算资产</dt>
							<dd>{asset}</dd>
						</div>
						<div>
							<dt>输入 / 百万 Token</dt>
							<dd>
								{usd(listing.inputRate)} {asset}
							</dd>
						</div>
						<div>
							<dt>输出 / 百万 Token</dt>
							<dd>
								{usd(listing.outputRate)} {asset}
							</dd>
						</div>
					</dl>
					{!isNativeAsset(asset) && (
						<p className="settlement-token">
							代币合约 <code>{network.token}</code>
						</p>
					)}
					<p>
						{listing.kind === "demo"
							? "模拟资源，无官方同款可比较。"
							: "模型 ID 和价格由提供者声明，模型身份未核验。"}
					</p>
				</div>
				<div className="field">
					<label htmlFor="rent-budget">锁定预算（{asset}）</label>
					<input
						id="rent-budget"
						max="100"
						min="1"
						onChange={(event) => onBudgetChange(event.target.value)}
						required
						step="0.000001"
						type="number"
						value={budget}
					/>
					<small>
						会话固定此资源、提供者和 {asset}{" "}
						挂牌价快照。每次调用先预留预算，关闭后可提取未使用的 {asset}
						。网络手续费使用 {nativeSymbol}，另计。
						{isNativeAsset(asset)
							? `请在钱包中确认 ${asset} 预算锁定交易。`
							: `需先确认 ${asset} 授权，再确认预算锁定交易。`}
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
						disabled={!!busy || uiPreview}
						type="submit"
					>
						{busy === "rent" ? (
							<LoaderCircle className="spin" size={12} />
						) : (
							<Wallet size={12} />
						)}
						{uiPreview
							? "预览模式 · 不执行交易"
							: busy === "rent"
								? "正在确认链上交易…"
								: "锁定预算并开始"}
					</button>
				</div>
			</form>
		</Modal>
	);
}

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
	const usd = assetFormatter(asset);
	return (
		<Modal
			error={error}
			onClose={() => !busy && onClose()}
			title={`退回未使用的 ${asset}`}
		>
			<div className="panel-body">
				<p>
					{session.listingName} · {session.model}
				</p>
				<p>
					可退额度：
					<strong>
						{usd(refund?.amount ?? remainingBudget(session), true)} {asset}
					</strong>
				</p>
				<p>
					申请后停止新调用。退款仍使用 {asset}，提取时的网络手续费使用{" "}
					{nativeSymbol}
					。已消费费用和网络手续费不退；待核对用量继续保留预留。
				</p>
				{refund && (
					<div className="notice info">
						{refund.status === "AVAILABLE"
							? "退款已转入可提现余额，请用钱包提取。若此前已提取，无需重复操作。"
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
						<button
							className="button primary"
							disabled={!!busy || !claimable || claimable === "0"}
							onClick={onWithdraw}
							type="button"
						>
							提取可提现 {asset} 到钱包
						</button>
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
				{refund?.status === "AVAILABLE" && (
					<p className="code-hint">
						提现会提取当前钱包的全部可提现余额，可能同时包含其他会话退款或商家收入。
					</p>
				)}
			</div>
		</Modal>
	);
}

export function KeyModal({
	sessions,
	sessionId,
	keyName,
	asset,
	busy,
	error,
	onClose,
	onKeyNameChange,
	onSelectSession,
	onSubmit,
}: {
	sessions: SessionView[];
	sessionId: string;
	keyName: string;
	asset: NetworkInfo["asset"];
	busy: string | null;
	error: string | null;
	onClose: () => void;
	onKeyNameChange: (value: string) => void;
	onSelectSession: (id: string) => void;
	onSubmit: (event: FormEvent) => void;
}) {
	const usd = assetFormatter(asset);
	return (
		<Modal
			error={error}
			onClose={() => !busy && onClose()}
			title="创建 API 密钥"
		>
			<form onSubmit={onSubmit}>
				<div className="field">
					<label htmlFor="key-name">密钥名称</label>
					<input
						id="key-name"
						maxLength={60}
						onChange={(event) => onKeyNameChange(event.target.value)}
						required
						value={keyName}
					/>
				</div>
				<div className="field">
					<label htmlFor="key-session">绑定预算会话</label>
					<ConsoleSelect
						id="key-session"
						onValueChange={onSelectSession}
						options={sessions.map((item) => ({
							value: item.id,
							label: item.listingName,
							description: `${short(item.id)} · 剩余 ${usd(remainingBudget(item), true)} ${asset}`,
							icon: Wallet,
						}))}
						placeholder="选择要绑定的预算会话"
						required
						value={sessionId}
					/>
					<small>
						密钥只能使用该会话的预算和资源，创建后完整密钥只显示一次。
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
						disabled={!sessionId || !!busy}
						type="submit"
					>
						{busy === "key" ? (
							<LoaderCircle className="spin" size={12} />
						) : (
							<KeyRound size={12} />
						)}
						创建密钥
					</button>
				</div>
			</form>
		</Modal>
	);
}
