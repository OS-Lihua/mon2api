"use client";

import { ArrowRight, FlaskConical, Network, Search, X } from "lucide-react";
import { useState } from "react";
import { formatAmount as usd } from "~/shared/money";
import type { ListingView, Snapshot } from "~/shared/token2api";
import { uiPreview } from "~/shared/ui-preview";
import { listingKind, onlineListings, short } from "./format";
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
	const asset = data.network.asset;
	const query = search.trim().toLowerCase();
	const visibleListings = data.listings.filter(
		(item) =>
			item.status !== "DISCOVERING" &&
			`${item.name} ${item.model} ${item.owner}`.toLowerCase().includes(query),
	);
	return (
		<>
			<div className="toolbar">
				<div className="search">
					<Search size={14} />
					<input
						aria-label="搜索资源"
						onChange={(event) => setSearch(event.target.value)}
						placeholder="搜索资源、模型或提供者"
						value={search}
					/>
					{search && (
						<button
							aria-label="清空资源搜索"
							className="search-clear"
							onClick={() => setSearch("")}
							type="button"
						>
							<X size={14} />
						</button>
					)}
				</div>
				<output aria-live="polite" className="search-results">
					{query
						? `找到 ${visibleListings.length} 个资源`
						: `${data.listings.length} 个资源 · ${onlineListings(data.listings)} 个已上架`}
				</output>
			</div>
			<p className="market-disclosure">
				模型 ID 与价格由提供者声明 · 暂无可比官方价
				{data.network.mode === "local"
					? " · 本地资产仅供测试"
					: ` · 使用 ${asset} 结算`}
			</p>
			<div className="resource-grid">
				{visibleListings.map((item) => (
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
							<span className="resource-budget-note">最低预算 1 {asset}</span>
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
			{!visibleListings.length && (
				<Empty
					description={
						search
							? "没有匹配的名称、声明模型或提供者。清空搜索后查看全部资源。"
							: "提供者上架资源后，模型与价格会显示在这里。"
					}
					icon={Search}
					title={search ? "没有匹配的资源" : "资源市场暂时为空"}
				>
					{search && (
						<button
							className="button"
							onClick={() => setSearch("")}
							type="button"
						>
							清空搜索
						</button>
					)}
				</Empty>
			)}
		</>
	);
}
