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
import type { Snapshot } from "~/shared/token2api";
import type { Section } from "./format";
import { Stats, UsageChart } from "./stats";
import { Panel } from "./ui";

const flow = [
	{ icon: Layers3, title: "模型" },
	{ icon: Wallet, title: "密钥" },
	{ icon: Activity, title: "用量" },
	{ icon: Coins, title: "结算" },
];

export function OverviewSection({
	data,
	nativeSymbol,
	navigate,
}: {
	data: Snapshot;
	nativeSymbol: string;
	navigate: (section: Section) => void;
}) {
	const asset = data.network.asset;
	return (
		<>
			<section className="hero">
				<div className="hero-copy">
					<span className="hero-eyebrow">模型 · 密钥 · 按量结算</span>
					<h2>创建密钥，开始调用。</h2>
					<p className="settlement-intro">
						在同一工作台核对预算、用量与结算记录。
					</p>
					<div className="hero-actions">
						<button
							className="button lime"
							onClick={() =>
								navigate(
									data.keys.some((key) => !key.revoked && !key.sessionId)
										? "lab"
										: "keys",
								)
							}
							type="button"
						>
							{data.keys.some((key) => !key.revoked && !key.sessionId)
								? "继续调用"
								: "创建 API Key"}{" "}
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
							<span>有效 API Key</span>
							<strong>{data.keys.filter((key) => !key.revoked).length}</strong>
						</div>
						<div className="overview-ledger-row">
							<span>已授权模型</span>
							<strong>
								{
									new Set(
										data.keys
											.filter((key) => !key.revoked)
											.flatMap((key) => key.models),
									).size
								}
							</strong>
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
				subtitle="创建 Key、授权模型、使用统一预付余额"
				title="接入应用"
			>
				<div className="panel-body">
					<ol className="onboarding-steps">
						<li>创建 API Key，勾选该 Key 可以使用的模型。</li>
						<li>充值统一预付余额，所有 Key 共用账户资金。</li>
						<li>使用平台 Base URL 调用已授权模型，上游由平台路由。</li>
					</ol>
				</div>
			</Panel>
		</>
	);
}
