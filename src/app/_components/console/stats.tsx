"use client";

import { Activity, Blocks, Wallet, Zap } from "lucide-react";
import type { Snapshot } from "~/shared/token2api";
import { assetFormatter, compact } from "./format";

export function Stats({ data }: { data: Snapshot }) {
	const usd = assetFormatter(data.network.asset);
	const tokens = data.metrics.inputTokens + data.metrics.outputTokens;
	const items = [
		{
			label: "关联调用",
			value: compact(data.metrics.requests),
			unit: "次",
			icon: Activity,
			foot: null,
		},
		{
			label: "Token 用量",
			value: compact(tokens),
			unit: "tokens",
			icon: Zap,
			foot:
				tokens > 0
					? `${compact(data.metrics.inputTokens)} 输入 / ${compact(data.metrics.outputTokens)} 输出`
					: null,
		},
		{
			label: "计费总额",
			value: usd(
				data.metrics.spent,
				data.metrics.spent > 0 && data.metrics.spent < 10000,
			),
			unit: data.network.asset,
			icon: Wallet,
			foot:
				data.metrics.pending > 0 || data.metrics.writtenOff > 0 ? (
					<>
						{data.metrics.pending > 0 && (
							<span>待链上结算 {usd(data.metrics.pending, true)}</span>
						)}
						{data.metrics.writtenOff > 0 && (
							<span>运营损失 {usd(data.metrics.writtenOff, true)}</span>
						)}
					</>
				) : null,
		},
		{
			label: "已结算金额",
			value: usd(
				data.metrics.settled,
				data.metrics.settled > 0 && data.metrics.settled < 10000,
			),
			unit: data.network.asset,
			icon: Blocks,
			foot: null,
		},
	];
	const scope = `统计范围：当前 ${data.requests.length} 条请求、${data.sessions.length} 个会话，非完整历史。`;
	return (
		<div className="stats-grid" title={scope}>
			{items.map(({ label, value, unit, icon: Icon, foot }) => (
				<section className="stat-card" key={label}>
					<div className="stat-top">
						<span>{label}</span>
						<span className="stat-icon">
							<Icon size={13} />
						</span>
					</div>
					<div className="stat-value">
						{value}
						<small>{unit}</small>
					</div>
					{foot && <div className="stat-foot">{foot}</div>}
				</section>
			))}
			<p className="sr-only">{scope}</p>
		</div>
	);
}

const HOUR = 3_600_000;

export function UsageChart({ data }: { data: Snapshot }) {
	if (!data.requests.length)
		return (
			<div className="chart-empty">
				<Activity size={24} strokeWidth={1.2} />
				<span>暂无调用记录</span>
			</div>
		);
	const currentHour = Math.floor(Date.now() / HOUR) * HOUR;
	const firstHour = currentHour - 5 * HOUR;
	// Bucket once instead of rescanning every request for each hour.
	const counts = Array.from({ length: 6 }, () => 0);
	for (const item of data.requests) {
		const slot = Math.floor(
			(new Date(item.createdAt).getTime() - firstHour) / HOUR,
		);
		if (slot >= 0 && slot < 6) counts[slot] = (counts[slot] ?? 0) + 1;
	}
	const periods = counts.map((count, index) => {
		const start = firstHour + index * HOUR;
		return {
			start,
			label: `${new Date(start).getHours().toString().padStart(2, "0")}:00`,
			count,
		};
	});
	const max = Math.max(...counts, 2);
	return (
		<div className="chart">
			<div className="chart-legend">
				<span>
					<i />
					请求数
				</span>
				<span>
					{counts.reduce((total, count) => total + count, 0)} 次 / 六小时
				</span>
			</div>
			<div className="chart-plot">
				<div className="chart-lines">
					{[
						{ id: "max", value: max },
						{ id: "middle", value: Math.round(max / 2) },
						{ id: "zero", value: 0 },
					].map((tick) => (
						<span key={tick.id}>
							<small>{tick.value}</small>
						</span>
					))}
				</div>
				<div aria-hidden="true" className="chart-bars">
					{periods.map((period) => (
						<div className="chart-bar-slot" key={period.start}>
							<div
								className="chart-bar"
								style={{ height: `${(period.count / max) * 100}%` }}
							/>
							<span aria-hidden="true" className="chart-tooltip">
								{period.label} / {period.count} 次
							</span>
						</div>
					))}
				</div>
			</div>
			<div className="chart-labels">
				{periods.map((period) => (
					<span key={period.start}>{period.label}</span>
				))}
			</div>
			<details className="chart-data-table">
				<summary>查看逐时数据</summary>
				<table>
					<thead>
						<tr>
							<th>时段（本地时间）</th>
							<th>请求数</th>
						</tr>
					</thead>
					<tbody>
						{periods.map((period) => (
							<tr key={period.start}>
								<td>{period.label}</td>
								<td>{period.count}</td>
							</tr>
						))}
					</tbody>
				</table>
			</details>
		</div>
	);
}
