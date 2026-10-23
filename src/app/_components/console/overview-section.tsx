"use client";

import { ArrowUpRight } from "lucide-react";
import type { Snapshot } from "~/shared/token2api";
import type { Section } from "./format";
import { Stats, UsageChart } from "./stats";
import { Panel } from "./ui";

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
