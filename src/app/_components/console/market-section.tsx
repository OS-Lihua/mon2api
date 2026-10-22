"use client";

import {
	ArrowRight,
	FlaskConical,
	LayoutGrid,
	List,
	Network,
	Search,
} from "lucide-react";
import { useState } from "react";
import { formatAmount as usd } from "~/shared/money";
import type { ListingView, Snapshot } from "~/shared/token2api";
import { uiPreview } from "~/shared/ui-preview";
import {
	CollectionToolbar,
	FilterField,
	Pagination,
	SearchField,
	usePagination,
} from "./collection";
import { listingKind, onlineListings, short } from "./format";
import { ResourceTable } from "./tables";
import { Empty, ListingStatusBadge } from "./ui";

export function MarketSection({
	data,
	busy,
	onRent,
}: {
	data: Snapshot;
	busy: boolean;
	onRent: (listing: ListingView) => void;
}) {
	const [search, setSearch] = useState("");
	const [availability, setAvailability] = useState("all");
	const [transport, setTransport] = useState("all");
	const [sort, setSort] = useState("available");
	const [view, setView] = useState("table");
	const asset = data.network.asset;
	const query = search.trim().toLowerCase();
	const visibleListings = data.listings
		.filter(
			(item) =>
				item.status !== "DISCOVERING" &&
				`${item.name} ${item.model} ${item.owner}`
					.toLowerCase()
					.includes(query) &&
				(availability === "all" ||
					(availability === "online"
						? item.enabled && item.online
						: !item.enabled || !item.online)) &&
				(transport === "all" || item.transport === transport),
		)
		.sort((left, right) =>
			sort === "input"
				? left.inputRate - right.inputRate
				: sort === "output"
					? left.outputRate - right.outputRate
					: sort === "newest"
						? right.createdAt.localeCompare(left.createdAt)
						: Number(right.enabled && right.online) -
							Number(left.enabled && left.online),
		);
	const pagination = usePagination(visibleListings, 9);
	const change = (setter: (value: string) => void) => (value: string) => {
		setter(value);
		pagination.setPage(1);
	};
	const filtered = !!query || availability !== "all" || transport !== "all";
	const reset = () => {
		setSearch("");
		setAvailability("all");
		setTransport("all");
		pagination.setPage(1);
	};
	return (
		<>
			<CollectionToolbar>
				<SearchField
					label="搜索资源"
					onChange={change(setSearch)}
					placeholder="资源、模型或提供者"
					value={search}
				/>
				<FilterField
					id="market-availability"
					label="资源可用状态"
					onChange={change(setAvailability)}
					options={[
						{ value: "all", label: "全部状态" },
						{ value: "online", label: "可用资源" },
						{ value: "unavailable", label: "暂不可用" },
					]}
					value={availability}
				/>
				<FilterField
					id="market-transport"
					label="资源接入类型"
					onChange={change(setTransport)}
					options={[
						{ value: "all", label: "全部接入类型" },
						{ value: "direct", label: "网关直连" },
						{ value: "local", label: "pool connector" },
					]}
					value={transport}
				/>
				<FilterField
					id="market-sort"
					label="资源排序"
					onChange={change(setSort)}
					options={[
						{ value: "available", label: "可用优先" },
						{ value: "input", label: "输入价从低到高" },
						{ value: "output", label: "输出价从低到高" },
						{ value: "newest", label: "最新上架" },
					]}
					value={sort}
				/>
				<fieldset className="view-switch">
					<legend className="sr-only">资源显示方式</legend>
					<button
						aria-label="表格视图"
						aria-pressed={view === "table"}
						onClick={() => setView("table")}
						type="button"
					>
						<List size={17} />
					</button>
					<button
						aria-label="卡片视图"
						aria-pressed={view === "cards"}
						onClick={() => setView("cards")}
						type="button"
					>
						<LayoutGrid size={17} />
					</button>
				</fieldset>
			</CollectionToolbar>
			<div className="collection-summary">
				<output aria-live="polite">
					{visibleListings.length} 个匹配资源 · {onlineListings(data.listings)}{" "}
					个可用资源
				</output>
				{filtered && (
					<button className="text-link" onClick={reset} type="button">
						重置筛选
					</button>
				)}
			</div>
			<p className="market-disclosure">
				模型 ID 与价格由提供者声明 · 暂无可比官方价
				{data.network.mode === "local"
					? " · 本地资产仅供测试"
					: ` · 使用 ${asset} 结算`}
			</p>
			{view === "table" && visibleListings.length ? (
				<div className="panel">
					<ResourceTable
						asset={asset}
						busy={busy || (!uiPreview && !data.network.ready)}
						listings={pagination.items}
						onRent={onRent}
					/>
				</div>
			) : (
				<div className="resource-grid">
					{pagination.items.map((item) => (
						<article className="resource-card" key={item.id}>
							<div className="resource-card-top">
								<span className="resource-card-kind">
									<span aria-hidden="true" className="resource-card-icon">
										{item.kind === "demo" ? (
											<FlaskConical size={18} />
										) : (
											<Network size={18} />
										)}
									</span>
									{listingKind(item, { demo: "模拟资源", api: "API 接入" })}
								</span>
								<ListingStatusBadge item={item} />
							</div>
							<h3>{item.name}</h3>
							<p className="resource-card-model">
								<span>声明模型</span>
								<code className="mono">{item.model}</code>
							</p>
							<p className="resource-card-description">{item.description}</p>
							<div className="resource-prices">
								<p className="resource-prices-heading">
									挂牌价 · {asset} / 百万 Token
								</p>
								<div className="resource-price">
									<span>输入</span>
									<strong>{usd(item.inputRate)}</strong>
								</div>
								<div className="resource-price">
									<span>输出</span>
									<strong>{usd(item.outputRate)}</strong>
								</div>
							</div>
							<div className="resource-card-details">
								<span>
									提供者 <span className="mono">{short(item.owner)}</span>
								</span>
								<span>
									并发 {item.activeRequests} / {item.concurrency}
								</span>
							</div>
							<div className="resource-card-bottom">
								<span className="resource-budget-note">固定资源与价格快照</span>
								<button
									className="button primary small"
									disabled={
										!item.enabled ||
										!item.online ||
										(!uiPreview && !data.network.ready) ||
										busy
									}
									onClick={() => onRent(item)}
									type="button"
								>
									创建预算会话 <ArrowRight size={11} />
								</button>
							</div>
						</article>
					))}
				</div>
			)}
			{!visibleListings.length && (
				<Empty
					description={
						filtered
							? "没有匹配的名称、声明模型或提供者。清空搜索后查看全部资源。"
							: "提供者上架资源后，模型与价格会显示在这里。"
					}
					icon={Search}
					title={filtered ? "没有匹配的资源" : "资源市场暂时为空"}
				>
					{filtered && (
						<button className="button" onClick={reset} type="button">
							重置筛选
						</button>
					)}
				</Empty>
			)}
			<Pagination
				{...pagination}
				label="资源市场"
				onChange={pagination.setPage}
			/>
		</>
	);
}
