"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
	Activity,
	ArrowRight,
	ArrowUpRight,
	Coins,
	Layers3,
	Wallet,
} from "lucide-react";
import type { ListingView, SessionView, Snapshot } from "~/shared/token2api";
import { onlineListings, type Section } from "./format";
import { Stats, UsageChart } from "./stats";
import { ResourceTable } from "./tables";
import { Panel } from "./ui";

const flow = [
	{ icon: Layers3, title: "资源" },
	{ icon: Wallet, title: "预算" },
	{ icon: Activity, title: "用量" },
	{ icon: Coins, title: "结算" },
];

export function OverviewSection({
	data,
	nativeSymbol,
	sessions,
	busy,
	navigate,
	onRent,
}: {
	data: Snapshot;
	nativeSymbol: string;
	sessions: SessionView[];
	busy: boolean;
	navigate: (section: Section) => void;
	onRent: (listing: ListingView) => void;
}) {
	const asset = data.network.asset;
	return (
		<>
			<section className="hero">
				<div className="hero-copy">
					<span className="hero-eyebrow">资源 · 预算 · 按量结算</span>
					<h2>选择资源，开始调用。</h2>
					<p className="settlement-intro">
						在同一工作台核对预算、用量与结算记录。
					</p>
					<div className="hero-actions">
						<button
							className="button lime"
							onClick={() => navigate(sessions.length ? "lab" : "market")}
							type="button"
						>
							{sessions.length ? "继续调用" : "查看可用资源"}{" "}
							<ArrowRight size={16} />
						</button>
						{!data.viewer && (
							<ConnectButton
								accountStatus="address"
								chainStatus="icon"
								label="连接钱包"
								showBalance={false}
							/>
						)}
					</div>
				</div>
				<div className="hero-route">
					<div className="hero-flow">
						{flow.map(({ icon: Icon, title }, index) => (
							<div className="flow-item" key={title}>
								<div
									className={`flow-node ${index === flow.length - 1 ? "flow-node-final" : ""}`}
								>
									<span className="flow-node-icon">
										<Icon size={18} strokeWidth={1.6} />
									</span>
									<span className="flow-node-title">{title}</span>
								</div>
								{index < flow.length - 1 && (
									<span aria-hidden="true" className="flow-connector" />
								)}
							</div>
						))}
					</div>
				</div>
			</section>
			<Stats data={data} />
			<div className="two-columns">
				<Panel title="调用活动">
					<UsageChart data={data} />
				</Panel>
				<Panel className="overview-side" title="当前市场">
					<div className="panel-body overview-ledger">
						<div className="overview-ledger-row">
							<span>结算网络</span>
							<strong className="settlement-value">
								{data.network.escrow ? data.network.name : "未配置"}
							</strong>
						</div>
						<div className="overview-ledger-row">
							<span>结算资产</span>
							<strong className="settlement-value">
								{data.network.escrow ? asset : "待开通"}
							</strong>
						</div>
						<div className="overview-ledger-row">
							<span>网络手续费</span>
							<strong className="settlement-value">
								{data.network.escrow ? nativeSymbol : "—"}
							</strong>
						</div>
						<div className="overview-ledger-row">
							<span>可用资源</span>
							<strong>{onlineListings(data.listings)}</strong>
						</div>
						<div className="overview-ledger-row">
							<span>我的活跃预算会话</span>
							<strong>{sessions.length}</strong>
						</div>
						<div className="overview-ledger-row">
							<span>相关已确认结算</span>
							<strong>
								{
									data.settlements.filter(
										(item) => item.status.toLowerCase() === "confirmed",
									).length
								}
							</strong>
						</div>
					</div>
				</Panel>
			</div>
			<Panel
				action={
					<button
						className="text-link"
						onClick={() => navigate("market")}
						type="button"
					>
						查看市场 <ArrowUpRight size={11} />
					</button>
				}
				subtitle={data.listings.length ? `${asset} / 百万 Token` : undefined}
				title="发现可用资源"
			>
				<ResourceTable
					asset={asset}
					busy={busy}
					listings={data.listings.slice(0, 4)}
					onRent={onRent}
				/>
			</Panel>
		</>
	);
}
