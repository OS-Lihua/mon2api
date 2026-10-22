"use client";

import { Activity, ArrowDownLeft, Blocks, CircleHelp } from "lucide-react";
import { useEffect, useState } from "react";
import { formatChainBalance, formatAmount as usd } from "~/shared/money";
import type { SessionView, Snapshot } from "~/shared/token2api";
import {
	CollectionToolbar,
	FilterField,
	Pagination,
	SearchField,
	usePagination,
} from "./collection";
import {
	date,
	requestUsagePending,
	short,
	statusLabel,
	statusTone,
} from "./format";
import { Stats } from "./stats";
import { SessionTable } from "./tables";
import { Badge, Empty, Panel, TableScroll, Transaction } from "./ui";

const jumpTargets = [
	{ id: "billing-sessions", label: "预算会话" },
	{ id: "billing-requests", label: "调用账单" },
	{ id: "billing-settlements", label: "链上结算记录" },
];
function focusHeading(id: string) {
	const heading = document.querySelector<HTMLHeadingElement>(`#${id} h2`);
	heading?.focus();
	heading?.scrollIntoView({ block: "start" });
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
	focusRequests: boolean;
	onFocused: () => void;
	onConfirm: (id: string) => void;
	onRefund: (session: SessionView) => void;
	onSelfClose: (session: SessionView) => void;
	onSettle: (id: string) => void;
	onWithdraw: () => void;
}) {
	const [sessionSearch, setSessionSearch] = useState("");
	const [sessionStatus, setSessionStatus] = useState("all");
	const [requestSearch, setRequestSearch] = useState("");
	const [requestStatus, setRequestStatus] = useState("all");
	const [requestSort, setRequestSort] = useState("newest");
	const [settlementStatus, setSettlementStatus] = useState("all");
	const sessionRows = data.sessions.filter(
		(item) =>
			`${item.listingName} ${item.model} ${item.id}`
				.toLowerCase()
				.includes(sessionSearch.trim().toLowerCase()) &&
			(sessionStatus === "all" || item.status.toUpperCase() === sessionStatus),
	);
	const requestRows = data.requests
		.filter(
			(item) =>
				`${item.id} ${item.model} ${item.listingName} ${item.sessionId}`
					.toLowerCase()
					.includes(requestSearch.trim().toLowerCase()) &&
				(requestStatus === "all" ||
					(requestStatus === "review"
						? requestUsagePending(item)
						: requestStatus === "settled"
							? item.settled && !requestUsagePending(item)
							: requestStatus === "unsettled"
								? !item.settled && !requestUsagePending(item)
								: item.status.toUpperCase() === "FAILED")),
		)
		.sort((left, right) =>
			requestSort === "cost"
				? Number(requestUsagePending(left)) -
						Number(requestUsagePending(right)) || right.cost - left.cost
				: right.createdAt.localeCompare(left.createdAt),
		);
	const settlementRows = data.settlements.filter(
		(item) =>
			settlementStatus === "all" ||
			item.status.toUpperCase() === settlementStatus,
	);
	const sessions = usePagination(sessionRows, 5);
	const requests = usePagination(requestRows);
	const settlements = usePagination(settlementRows);
	const pendingUsage = data.requests.filter(requestUsagePending).length;
	const asset = data.network.asset;
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
			{!!pendingUsage && (
				<div className="notice warning" role="status">
					<CircleHelp size={16} />
					<span>
						{pendingUsage}{" "}
						条调用用量尚未确认。预留预算继续保留，实际费用和结算结果以核对结果为准。
					</span>
				</div>
			)}
			<div className="two-columns">
				<Panel
					subtitle="已入账的商家收入与会话退款，提取后到账钱包"
					title="可提现余额"
				>
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
									: `${formatChainBalance(walletBalance, asset, data.network.tokenDecimals)} ${asset}`}
							</span>
							<button
								className="button primary"
								disabled={
									!data.viewer || !claimable || claimable === "0" || busy
								}
								onClick={onWithdraw}
								type="button"
							>
								<ArrowDownLeft size={15} />
								提取余额
							</button>
						</div>
					</div>
				</Panel>
				<Panel
					subtitle={`${data.network.name} · ${asset} 结算`}
					title="资金流转"
				>
					<div className="panel-body settlement-rules">
						<ol className="funding-steps">
							<li>锁定预算，调用前预留费用。</li>
							<li>确认用量，按固定报价核销并结算。</li>
							<li>申请退款，核对后转入可提现余额。</li>
						</ol>
						<p>
							平台服务费 {(data.network.feeBps / 100).toFixed(1)}
							%。网络手续费另计。
						</p>
						<p className="mono escrow-address">
							托管合约 / {data.network.escrow || "未配置"}
						</p>
					</div>
				</Panel>
			</div>
			<div className="section-stack">
				<Panel
					id="billing-sessions"
					subtitle={`当前返回 ${data.sessions.length} 个会话（最多 100 个），筛选与分页仅作用于这些记录 · 金额单位 ${asset}`}
					title="预算会话"
				>
					<CollectionToolbar>
						<SearchField
							label="搜索预算会话"
							onChange={(value) => {
								setSessionSearch(value);
								sessions.setPage(1);
							}}
							placeholder="资源、模型或会话 ID"
							value={sessionSearch}
						/>
						<FilterField
							id="session-status"
							label="预算会话状态"
							onChange={(value) => {
								setSessionStatus(value);
								sessions.setPage(1);
							}}
							options={[
								{ value: "all", label: "全部状态" },
								...["ACTIVE", "DRAFT", "CLOSING", "CLOSED"].map((value) => ({
									value,
									label: statusLabel(value),
								})),
							]}
							value={sessionStatus}
						/>
					</CollectionToolbar>
					{sessionRows.length ? (
						<SessionTable
							busy={busy}
							data={data}
							onClose={onRefund}
							onConfirm={onConfirm}
							onSelfClose={onSelfClose}
							onSettle={onSettle}
							sessions={sessions.items}
						/>
					) : (
						<Empty
							description={
								data.sessions.length
									? "调整名称或状态筛选后重试。"
									: "先在资源市场选择资源并锁定预算。"
							}
							title={
								data.sessions.length ? "没有匹配的预算会话" : "还没有预算会话"
							}
						/>
					)}
					<Pagination
						{...sessions}
						label="预算会话"
						onChange={sessions.setPage}
					/>
				</Panel>
				<Panel
					id="billing-requests"
					subtitle={`当前返回 ${data.requests.length} 条请求（最多 200 条），筛选与分页仅作用于这些记录 · 费用单位 ${asset}`}
					title="调用账单"
				>
					<CollectionToolbar>
						<SearchField
							label="搜索调用账单"
							onChange={(value) => {
								setRequestSearch(value);
								requests.setPage(1);
							}}
							placeholder="请求、模型、资源或会话 ID"
							value={requestSearch}
						/>
						<FilterField
							id="request-status"
							label="调用账单状态"
							onChange={(value) => {
								setRequestStatus(value);
								requests.setPage(1);
							}}
							options={[
								{ value: "all", label: "全部状态" },
								{ value: "review", label: "用量未确认" },
								{ value: "settled", label: "已结算" },
								{ value: "unsettled", label: "尚未结算" },
								{ value: "failed", label: "失败" },
							]}
							value={requestStatus}
						/>
						<FilterField
							id="request-sort"
							label="调用账单排序"
							onChange={(value) => {
								setRequestSort(value);
								requests.setPage(1);
							}}
							options={[
								{ value: "newest", label: "最新调用" },
								{ value: "cost", label: "已确认费用从高到低" },
							]}
							value={requestSort}
						/>
					</CollectionToolbar>
					{requestRows.length ? (
						<TableScroll label="调用费用与计量状态">
							<table>
								<thead>
									<tr>
										<th>请求 / 时间</th>
										<th>资源 / 模型</th>
										<th>输入 / 输出 Token</th>
										<th>费用（{asset}）</th>
										<th>计量来源</th>
										<th>状态</th>
									</tr>
								</thead>
								<tbody>
									{requests.items.map((item) => (
										<tr key={item.id}>
											<td>
												<span className="mono" title={item.id}>
													{short(item.id)}
												</span>
												<small className="table-secondary">
													{date(item.createdAt)}
												</small>
											</td>
											<td>
												{item.listingName}
												<small className="mono table-secondary">
													{item.model}
												</small>
											</td>
											<td className="mono">
												{item.inputTokens ?? "待核对"} /{" "}
												{item.outputTokens ?? "待核对"}
											</td>
											<td
												className={`mono ${requestUsagePending(item) ? "pending-amount" : ""}`}
											>
												{requestUsagePending(item)
													? "待核对"
													: usd(item.cost, true)}
											</td>
											<td>{item.usageSource || "—"}</td>
											<td>
												<Badge
													tone={
														requestUsagePending(item)
															? "warn"
															: statusTone(
																	item.settled
																		? "settled"
																		: item.status.toUpperCase() === "COMPLETED"
																			? "pending"
																			: item.status,
																)
													}
												>
													{requestUsagePending(item)
														? item.status.toUpperCase() === "RUNNING"
															? "执行中 · 计量未确认"
															: "待核对 · 保留预留"
														: item.settled
															? "已结算"
															: item.status.toUpperCase() === "COMPLETED"
																? "已计量 · 待结算"
																: statusLabel(item.status)}
												</Badge>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</TableScroll>
					) : (
						<Empty
							description={
								data.requests.length
									? "调整搜索或状态筛选后重试。"
									: "发起调用后，可在此核对用量、费用与结算状态。"
							}
							icon={Activity}
							title={
								data.requests.length ? "没有匹配的调用账单" : "还没有调用账单"
							}
						/>
					)}
					<Pagination
						{...requests}
						label="调用账单"
						onChange={requests.setPage}
					/>
				</Panel>
				<Panel
					id="billing-settlements"
					subtitle={`当前返回 ${data.settlements.length} 笔结算（最多 100 笔），分页仅作用于这些记录`}
					title="链上结算记录"
				>
					<CollectionToolbar>
						<FilterField
							id="settlement-status"
							label="链上结算状态"
							onChange={(value) => {
								setSettlementStatus(value);
								settlements.setPage(1);
							}}
							options={[
								{ value: "all", label: "全部状态" },
								...Array.from(
									new Set(
										data.settlements.map((item) => item.status.toUpperCase()),
									),
								).map((value) => ({ value, label: statusLabel(value) })),
							]}
							value={settlementStatus}
						/>
					</CollectionToolbar>
					{settlementRows.length ? (
						<TableScroll label="链上结算记录">
							<table>
								<thead>
									<tr>
										<th>结算批次 / 会话</th>
										<th>金额（{asset}）</th>
										<th>时间</th>
										<th>交易</th>
										<th>状态</th>
									</tr>
								</thead>
								<tbody>
									{settlements.items.map((item) => (
										<tr key={item.id}>
											<td className="mono" title={item.id}>
												{short(item.id)}
												<small
													className="table-secondary"
													title={item.sessionId}
												>
													{short(item.sessionId)}
												</small>
											</td>
											<td className="mono">{usd(item.amount, true)}</td>
											<td>{date(item.createdAt)}</td>
											<td>
												<Transaction
													hash={item.txHash}
													network={data.network}
												/>
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
							description={
								data.settlements.length
									? "可切换到全部状态查看其他记录。"
									: "已确认费用提交结算后，交易结果会显示在这里。"
							}
							icon={Blocks}
							title={
								data.settlements.length
									? "没有匹配的结算记录"
									: "等待第一笔结算"
							}
						/>
					)}
					<Pagination
						{...settlements}
						label="链上结算"
						onChange={settlements.setPage}
					/>
				</Panel>
			</div>
		</>
	);
}
