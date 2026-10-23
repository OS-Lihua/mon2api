"use client";

import { ArrowUpRight, Power, Server, Wallet } from "lucide-react";
import { formatAmount as usd } from "~/shared/money";
import type { ListingView, SessionView, Snapshot } from "~/shared/token2api";
import {
	listingKind,
	remainingBudget,
	sameAddress,
	short,
	statusLabel,
	statusTone,
} from "./format";
import {
	Badge,
	Empty,
	ListingStatusBadge,
	TableScroll,
	Transaction,
} from "./ui";

export function ResourceTable({
	listings,
	onRent,
	onToggle,
	onConnect,
	busy,
	asset,
}: {
	asset: Snapshot["network"]["asset"];
	listings: ListingView[];
	onRent?: (listing: ListingView) => void;
	onToggle?: (listing: ListingView) => void;
	onConnect?: (listing: ListingView) => void;
	busy: boolean;
}) {
	if (!listings.length) return onToggle ? null : <Empty title="暂无资源" />;
	return (
		<TableScroll>
			<table>
				<caption className="sr-only">报价单位：{asset} / 百万 Token</caption>
				<thead>
					<tr>
						<th>资源 / 模型</th>
						<th>接入类型</th>
						<th className="numeric">输入价格</th>
						<th className="numeric">输出价格</th>
						<th className="numeric">并发</th>
						<th>状态</th>
						<th>操作</th>
					</tr>
				</thead>
				<tbody>
					{listings.map((item) => (
						<tr key={item.id}>
							<td>
								<div className="resource-name">
									<span className="resource-symbol">
										<Server size={13} />
									</span>
									<div>
										{item.name}
										<small className="mono">{item.model}</small>
										{onRent && (
											<small className="mono" title={item.owner}>
												提供者 {short(item.owner)}
											</small>
										)}
									</div>
								</div>
							</td>
							<td>
								<span className="badge neutral">
									{listingKind(item, { demo: "模拟资源", api: "网关直连" })}
								</span>
							</td>
							<td className="mono numeric">{usd(item.inputRate)}</td>
							<td className="mono numeric">{usd(item.outputRate)}</td>
							<td className="mono numeric">
								{item.activeRequests}
								<span className="table-muted"> / {item.concurrency}</span>
							</td>
							<td>
								<ListingStatusBadge item={item} />
							</td>
							<td className="resource-actions">
								{onToggle ? (
									<>
										<button
											className="button small"
											disabled={busy || item.status === "DISCOVERING"}
											onClick={() => onToggle(item)}
											type="button"
										>
											<Power size={10} />
											{item.enabled ? "暂停" : "上架"}
										</button>
										{item.transport === "local" && onConnect && (
											<button
												className="button small"
												disabled={busy}
												onClick={() => onConnect(item)}
												type="button"
											>
												{item.status === "DISCOVERING"
													? "继续接入"
													: "重置连接凭证"}
											</button>
										)}
									</>
								) : (
									<button
										className="text-link"
										disabled={!item.enabled || !item.online || busy}
										onClick={() => onRent?.(item)}
										title={
											!item.enabled || !item.online
												? "资源暂不可用，请选择其他资源"
												: "固定当前资源与报价，创建预算会话"
										}
										type="button"
									>
										锁定预算 <ArrowUpRight size={11} />
									</button>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</TableScroll>
	);
}

export function SessionTable({
	onConfirm,
	onSelfClose,
	data,
	onSettle,
	onClose,
	busy,
	sessions,
}: {
	data: Snapshot;
	onConfirm: (id: string) => void;
	onSelfClose: (session: SessionView) => void;
	onSettle: (id: string) => void;
	onClose: (session: SessionView) => void;
	busy: boolean;
	sessions: SessionView[];
}) {
	if (!sessions.length)
		return (
			<Empty
				description="创建 Key、授权模型并充值后，平台会在调用时自动预留预算。"
				icon={Wallet}
				title="还没有调用预留或原有预算会话"
			/>
		);
	const viewer = data.viewer;
	return (
		<TableScroll>
			<table>
				<thead>
					<tr>
						<th>资源 / 会话</th>
						<th>预算 / 可用（{data.network.asset}）</th>
						<th>已消费 / 已结算（{data.network.asset}）</th>
						<th>状态</th>
						<th>锁定交易</th>
						<th>操作</th>
					</tr>
				</thead>
				<tbody>
					{sessions.map((item) => {
						const ownSession = sameAddress(item.consumer, viewer?.address);
						return (
							<tr key={item.id}>
								<td>
									{item.listingName}
									<small className="table-secondary">
										{item.fundingSource === "PREPAID"
											? "预付账户 · 自动预留"
											: "原有预算会话"}
									</small>
									<small className="mono table-secondary" title={item.id}>
										{short(item.id)}
									</small>
								</td>
								<td className="mono">
									{usd(item.budget)}
									<small className="table-secondary">
										可用 {usd(remainingBudget(item), true)}
									</small>
								</td>
								<td className="mono">
									{usd(item.spent, true)} / {usd(item.settled, true)}
									{item.reserved > 0 && (
										<small className="table-secondary pending-amount">
											预留 {usd(item.reserved, true)} · 尚未确认为费用
										</small>
									)}
									{item.writtenOff > 0 && (
										<small className="table-secondary">
											运营损失 {usd(item.writtenOff, true)}
										</small>
									)}
								</td>
								<td>
									<Badge tone={statusTone(item.status)}>
										{statusLabel(item.status)}
									</Badge>
								</td>
								<td>
									<Transaction hash={item.openTx} network={data.network} />
								</td>
								<td>
									<div className="table-actions">
										{item.status === "DRAFT" && ownSession && (
											<button
												className="button small"
												disabled={busy}
												onClick={() => onConfirm(item.id)}
												type="button"
											>
												确认预算状态
											</button>
										)}
										<button
											className="button small"
											disabled={
												busy ||
												item.spent - item.settled - item.writtenOff <= 0 ||
												item.status.toLowerCase() === "closed"
											}
											onClick={() => onSettle(item.id)}
											type="button"
										>
											结算
										</button>
										<button
											className="button small"
											disabled={
												busy ||
												item.status.toLowerCase() === "draft" ||
												!ownSession
											}
											onClick={() => onClose(item)}
											type="button"
										>
											{item.status === "CLOSED"
												? "查看退款"
												: item.status === "CLOSING"
													? "退款处理中"
													: "申请退款"}
										</button>
										{viewer &&
											!viewer.demo &&
											ownSession &&
											item.status !== "DRAFT" &&
											item.status !== "CLOSED" && (
												<button
													className="button small"
													disabled={busy}
													onClick={() => onSelfClose(item)}
													title="直接调用合约，120 秒结算窗口后可关闭并取回预算"
													type="button"
												>
													<Wallet size={10} />
													钱包自助退出
												</button>
											)}
									</div>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</TableScroll>
	);
}
