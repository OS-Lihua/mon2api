"use client";

import { ArrowRight, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { formatChainBalance } from "~/shared/money";
import type { ListingView, Snapshot } from "~/shared/token2api";
import {
	CollectionToolbar,
	FilterField,
	Pagination,
	SearchField,
	usePagination,
} from "./collection";
import { type Section, sameAddress } from "./format";
import { ResourceTable } from "./tables";
import { Empty, Panel } from "./ui";

export function PoolSection({
	data,
	busy,
	onConnect,
	onToggle,
	navigate,
}: {
	data: Snapshot;
	busy: boolean;
	onConnect: (listing: ListingView) => void;
	onToggle: (listing: ListingView) => void;
	navigate: (section: Section) => void;
}) {
	const owned = data.listings.filter((item) =>
		sameAddress(item.owner, data.viewer?.address),
	);
	const [search, setSearch] = useState("");
	const [status, setStatus] = useState("all");
	const rows = owned.filter(
		(item) =>
			`${item.name} ${item.model}`
				.toLowerCase()
				.includes(search.trim().toLowerCase()) &&
			(status === "all" ||
				(status === "enabled" ? item.enabled : !item.enabled)),
	);
	const pagination = usePagination(rows);
	const providerSessions = new Set(
		data.sessions
			.filter((item) => sameAddress(item.provider, data.viewer?.address))
			.map((item) => item.id),
	);
	const requests = data.requests.filter((item) =>
		providerSessions.has(item.sessionId),
	);
	return (
		<>
			<div className="merchant-summary">
				<section className="stat-card">
					<div className="stat-top">我提供的资源</div>
					<div className="stat-value">
						{owned.length}
						<small>个</small>
					</div>
					<p className="stat-foot">
						{owned.filter((item) => item.enabled && item.online).length}{" "}
						个可用资源
					</p>
				</section>
				<section className="stat-card">
					<div className="stat-top">关联调用</div>
					<div className="stat-value">
						{requests.length}
						<small>次</small>
					</div>
					<p className="stat-foot">当前返回记录中，商家会话的调用</p>
				</section>
				<section className="stat-card">
					<div className="stat-top">可提现余额</div>
					<div className="stat-value">
						{data.metrics.claimable === null
							? "暂不可用"
							: formatChainBalance(
									data.metrics.claimable,
									data.network.asset,
									data.network.tokenDecimals,
								)}
						{data.metrics.claimable !== null && (
							<small>{data.network.asset}</small>
						)}
					</div>
					<p className="stat-foot">已入账收入与退款合计</p>
				</section>
			</div>
			<div className="notice info">
				<ShieldCheck size={14} />
				<span>仅接入有权提供的服务；限流不保证避免上游停用。</span>
			</div>
			<Panel
				action={
					<button
						className="text-link"
						onClick={() => navigate("billing")}
						type="button"
					>
						用量与收入账单 <ArrowRight size={14} />
					</button>
				}
				subtitle={`网关直连与 pool connector · 报价单位 ${data.network.asset} / 百万 Token`}
				title="我提供的资源"
			>
				<CollectionToolbar>
					<SearchField
						label="搜索我的资源"
						onChange={(value) => {
							setSearch(value);
							pagination.setPage(1);
						}}
						placeholder="资源名称或模型"
						value={search}
					/>
					<FilterField
						id="pool-status"
						label="我的资源状态"
						onChange={(value) => {
							setStatus(value);
							pagination.setPage(1);
						}}
						options={[
							{ value: "all", label: "全部状态" },
							{ value: "enabled", label: "已上架" },
							{ value: "paused", label: "未上架" },
						]}
						value={status}
					/>
				</CollectionToolbar>
				<ResourceTable
					asset={data.network.asset}
					busy={busy}
					listings={pagination.items}
					onConnect={onConnect}
					onToggle={onToggle}
				/>
				{!owned.length && (
					<Empty
						description="使用页首的「接入资源」，添加本机连接器或你自行部署的上游网关。"
						title="开始提供第一份资源"
					/>
				)}
				{!!owned.length && !rows.length && (
					<Empty
						description="调整资源名称或上架状态筛选后重试。"
						title="没有匹配的资源"
					/>
				)}
				<Pagination
					{...pagination}
					label="我的资源"
					onChange={pagination.setPage}
				/>
			</Panel>
		</>
	);
}
