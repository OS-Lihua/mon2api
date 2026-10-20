"use client";

import { Activity, ArrowDownLeft, Blocks } from "lucide-react";
import { useEffect, useState } from "react";
import { formatChainBalance } from "~/shared/money";
import type { SessionView, Snapshot } from "~/shared/token2api";
import { assetFormatter, date, short, statusLabel, statusTone } from "./format";
import { Stats } from "./stats";
import { SessionTable } from "./tables";
import {
	Badge,
	Empty,
	Panel,
	ShowAllToggle,
	TableScroll,
	Transaction,
} from "./ui";

const jumpTargets = [
	{ id: "billing-sessions", label: "预算会话" },
	{ id: "billing-requests", label: "调用账单" },
	{ id: "billing-settlements", label: "链上结算记录" },
];

function focusHeading(id: string) {
	const heading = document.querySelector<HTMLHeadingElement>(`#${id} h2`);
	heading?.focus();
	heading?.scrollIntoView();
}

export function BillingSection({
	data,
	busy,
	focusRequests,
	onConfirm,
	onFocused,
	onRefund,
	onSelfClose,
	onSettle,
	onWithdraw,
}: {
	data: Snapshot;
	busy: boolean;
	/** Move focus to the request ledger once rendered, e.g. after a lab call. */
	focusRequests: boolean;
	onFocused: () => void;
	onConfirm: (id: string) => void;
	onRefund: (session: SessionView) => void;
	onSelfClose: (session: SessionView) => void;
	onSettle: (id: string) => void;
	onWithdraw: () => void;
}) {
	const [showAllSessions, setShowAllSessions] = useState(false);
	const [showAllRequests, setShowAllRequests] = useState(false);
	const [showAllSettlements, setShowAllSettlements] = useState(false);
	const asset = data.network.asset;
	const usd = assetFormatter(asset);
	const { claimable, walletBalance } = data.metrics;
	useEffect(() => {
		if (!focusRequests) return;
		const frame = window.requestAnimationFrame(() => {
			focusHeading("billing-requests");
			onFocused();
		});
		return () => window.cancelAnimationFrame(frame);
	}, [focusRequests, onFocused]);
	return (
		<>
			<nav aria-label="账单内容" className="billing-jump">
				{jumpTargets.map(({ id, label }) => (
					<button key={id} onClick={() => focusHeading(id)} type="button">
						{label}
					</button>
				))}
			</nav>
			<Stats data={data} />
			<div className="two-columns">
				<Panel subtitle="收益与退款" title="可提现余额">
					<div className="panel-body billing-summary">
						<div className="stat-value">
							{claimable === null
								? "暂不可用"
								: formatChainBalance(
										claimable,
										asset,
										data.network.tokenDecimals,
									)}
							{claimable !== null && <small>{asset}</small>}
						</div>
						<div className="balance-row">
							<span>
								钱包余额{" "}
								{walletBalance === null
									? "暂不可用"
									: formatChainBalance(
											walletBalance,
											asset,
											data.network.tokenDecimals,
										)}
							</span>
							<button
								className="button primary"
								disabled={
									!data.viewer || !claimable || claimable === "0" || busy
								}
								onClick={onWithdraw}
								type="button"
							>
								<ArrowDownLeft size={12} />
								提取余额
							</button>
						</div>
					</div>
				</Panel>
				<Panel subtitle="费用来自网关计量，合约验证预算与分账" title="结算规则">
					<div className="panel-body settlement-rules">
						平台服务费 {(data.network.feeBps / 100).toFixed(1)}
						%。每批账单按累计费用结算，避免重复扣款。关闭会话后，剩余预算依合约规则退回钱包。
						<p className="mono escrow-address">
							托管合约 / {data.network.escrow || "未配置"}
						</p>
					</div>
				</Panel>
			</div>
			<Panel
				action={
					<ShowAllToggle
						collapseLabel="收起会话"
						count={data.sessions.length}
						expanded={showAllSessions}
						expandLabel={`查看全部 ${data.sessions.length} 个会话`}
						limit={5}
						onToggle={() => setShowAllSessions((value) => !value)}
					/>
				}
				id="billing-sessions"
				subtitle="最近 100 个会话"
				title="预算会话"
			>
				<SessionTable
					busy={busy}
					data={data}
					onClose={onRefund}
					onConfirm={onConfirm}
					onSelfClose={onSelfClose}
					onSettle={onSettle}
					showAll={showAllSessions}
				/>
			</Panel>
			<div style={{ height: 22 }} />
			<Panel
				action={
					<ShowAllToggle
						collapseLabel="收起账单"
						count={data.requests.length}
						expanded={showAllRequests}
						expandLabel={`查看全部 ${data.requests.length} 条账单`}
						limit={8}
						onToggle={() => setShowAllRequests((value) => !value)}
					/>
				}
				id="billing-requests"
				subtitle="最近 200 条请求 · 待核对用量保留预算"
				title="调用账单"
			>
				{data.requests.length ? (
					<TableScroll>
						<table>
							<thead>
								<tr>
									<th>请求 / 时间</th>
									<th>模型</th>
									<th>输入 / 输出 Token</th>
									<th>费用</th>
									<th>计量来源</th>
									<th>状态</th>
								</tr>
							</thead>
							<tbody>
								{(showAllRequests
									? data.requests
									: data.requests.slice(0, 8)
								).map((item) => (
									<tr key={item.id}>
										<td>
											<span className="mono">{short(item.id)}</span>
											<small className="table-secondary">
												{date(item.createdAt)}
											</small>
										</td>
										<td className="mono">{item.model}</td>
										<td className="mono">
											{item.inputTokens ?? "待核对"} /{" "}
											{item.outputTokens ?? "待核对"}
										</td>
										<td className="mono">{usd(item.cost, true)}</td>
										<td>{item.usageSource}</td>
										<td>
											<Badge tone={statusTone(item.status)}>
												{item.settled ? "已结算" : statusLabel(item.status)}
											</Badge>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</TableScroll>
				) : (
					<Empty
						description="在调用实验室发起请求，费用会出现在这里。"
						icon={Activity}
						title="还没有调用账单"
					/>
				)}
			</Panel>
			<div style={{ height: 22 }} />
			<Panel
				action={
					<ShowAllToggle
						collapseLabel="收起记录"
						count={data.settlements.length}
						expanded={showAllSettlements}
						expandLabel={`查看全部 ${data.settlements.length} 笔结算`}
						limit={8}
						onToggle={() => setShowAllSettlements((value) => !value)}
					/>
				}
				id="billing-settlements"
				subtitle="最近 100 笔结算"
				title="链上结算记录"
			>
				{data.settlements.length ? (
					<TableScroll>
						<table>
							<thead>
								<tr>
									<th>结算批次</th>
									<th>金额</th>
									<th>时间</th>
									<th>交易</th>
									<th>状态</th>
								</tr>
							</thead>
							<tbody>
								{(showAllSettlements
									? data.settlements
									: data.settlements.slice(0, 8)
								).map((item) => (
									<tr key={item.id}>
										<td className="mono">{short(item.id)}</td>
										<td className="mono">{usd(item.amount, true)}</td>
										<td>{date(item.createdAt)}</td>
										<td>
											<Transaction hash={item.txHash} network={data.network} />
										</td>
										<td>
											<Badge tone={statusTone(item.status)}>
												{statusLabel(item.status)}
											</Badge>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</TableScroll>
				) : (
					<Empty
						description="调用产生费用后，在预算会话中点击结算即可生成链上交易。"
						icon={Blocks}
						title="等待第一笔结算"
					/>
				)}
			</Panel>
		</>
	);
}
