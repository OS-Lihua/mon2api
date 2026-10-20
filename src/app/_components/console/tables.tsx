"use client";

import { ArrowUpRight, Power, Server, Wallet } from "lucide-react";
import type { SettlementAsset } from "~/shared/settlement-asset";
import type { ListingView, SessionView, Snapshot } from "~/shared/token2api";
import {
	assetFormatter,
	listingKind,
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
	asset,
	listings,
	onRent,
	onToggle,
	onConnect,
	busy,
}: {
	asset: SettlementAsset;
	listings: ListingView[];
	onRent?: (listing: ListingView) => void;
	onToggle?: (listing: ListingView) => void;
	onConnect?: (listing: ListingView) => void;
	busy: boolean;
}) {
	const usd = assetFormatter(asset);
	if (!listings.length) return onToggle ? null : <Empty title="暂无资源" />;
	return (
		<TableScroll>
			<table>
				<thead>
					<tr>
						<th>资源 / 模型</th>
						<th>接入类型</th>
						<th>输入 / 输出价格</th>
						<th>并发</th>
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
									</div>
								</div>
							</td>
							<td>
								<span className="badge neutral">
									{listingKind(item, { demo: "DEMO", api: "API" })}
								</span>
							</td>
							<td className="mono">
								{usd(item.inputRate)} / {usd(item.outputRate)}
							</td>
							<td className="mono">
								{item.activeRequests}
								<span className="table-muted"> / {item.concurrency}</span>
							</td>
							<td>
								<ListingStatusBadge item={item} />
							</td>
							<td>
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
										type="button"
									>
										使用资源 <ArrowUpRight size={11} />
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
	showAll,
}: {
	data: Snapshot;
	onConfirm: (id: string) => void;
	onSelfClose: (session: SessionView) => void;
	onSettle: (id: string) => void;
	onClose: (session: SessionView) => void;
	busy: boolean;
	showAll: boolean;
}) {
	const usd = assetFormatter(data.network.asset);
	if (!data.sessions.length)
		return (
			<Empty
				description="在资源市场选择模型并锁定预算，即可开始调用。"
				icon={Wallet}
				title="还没有预算会话"
			/>
		);
	const viewer = data.viewer;
	return (
		<TableScroll>
			<table>
				<thead>
					<tr>
						<th>资源 / 会话</th>
						<th>预算</th>
						<th>已消费 / 已结算 / 运营损失</th>
						<th>状态</th>
						<th>锁定交易</th>
						<th>操作</th>
					</tr>
				</thead>
				<tbody>
					{(showAll ? data.sessions : data.sessions.slice(0, 5)).map((item) => {
						const ownSession = sameAddress(item.consumer, viewer?.address);
						return (
							<tr key={item.id}>
								<td>
									{item.listingName}
									<small className="mono table-secondary" title={item.id}>
										{short(item.id)}
									</small>
								</td>
								<td className="mono">{usd(item.budget)}</td>
								<td className="mono">
									{usd(item.spent, true)} / {usd(item.settled, true)} /{" "}
									{usd(item.writtenOff, true)}
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
