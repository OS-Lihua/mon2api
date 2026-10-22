"use client";

import { ArrowRight, Globe2 } from "lucide-react";
import { useState } from "react";
import type { ModelView } from "~/shared/model-routing";
import { formatAmount } from "~/shared/money";
import {
	CollectionToolbar,
	FilterField,
	Pagination,
	SearchField,
	usePagination,
} from "./collection";
import { Badge, Empty, Loading, QueryError, TableScroll } from "./ui";

export function MarketSection({
	models,
	asset,
	busy,
	signedIn,
	loading,
	error,
	onRetry,
	onCreateKey,
}: {
	models: ModelView[];
	asset: string;
	busy: boolean;
	signedIn: boolean;
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	onCreateKey: (models: string[]) => void;
}) {
	const [search, setSearch] = useState("");
	const [availability, setAvailability] = useState("all");
	const [sort, setSort] = useState("name");
	const filtered = models
		.filter(
			(model) =>
				`${model.id} ${model.name}`
					.toLowerCase()
					.includes(search.trim().toLowerCase()) &&
				(availability === "all" ||
					(availability === "available" ? model.available : !model.available)),
		)
		.sort((a, b) =>
			sort === "input"
				? a.inputRate - b.inputRate
				: sort === "output"
					? a.outputRate - b.outputRate
					: a.name.localeCompare(b.name, "zh-CN"),
		);
	const pagination = usePagination(filtered, 9);
	if (loading) return <Loading label="正在读取平台模型…" />;
	if (error) return <QueryError message={error} onRetry={onRetry} />;
	return (
		<>
			<div className="notice info">
				<Globe2 size={16} />
				<span>
					按平台统一报价调用。创建 Key 并选择允许使用的模型，上游由平台路由。
				</span>
			</div>
			<CollectionToolbar>
				<SearchField
					label="搜索模型"
					onChange={(value) => {
						setSearch(value);
						pagination.setPage(1);
					}}
					placeholder="模型名称或 ID"
					value={search}
				/>
				<FilterField
					id="model-availability"
					label="模型可用状态"
					onChange={(value) => {
						setAvailability(value);
						pagination.setPage(1);
					}}
					options={[
						{ value: "all", label: "全部模型" },
						{ value: "available", label: "可路由" },
						{ value: "unavailable", label: "暂无可用上游" },
					]}
					value={availability}
				/>
				<FilterField
					id="model-sort"
					label="模型排序"
					onChange={(value) => {
						setSort(value);
						pagination.setPage(1);
					}}
					options={[
						{ value: "name", label: "模型名称" },
						{ value: "input", label: "输入价从低到高" },
						{ value: "output", label: "输出价从低到高" },
					]}
					value={sort}
				/>
			</CollectionToolbar>
			<p className="muted">
				{filtered.length} 个匹配模型 · 报价单位 {asset} / 百万 Token
			</p>
			{filtered.length ? (
				<TableScroll label="平台模型与统一报价">
					<table>
						<thead>
							<tr>
								<th>模型</th>
								<th>输入 / 输出（{asset} / 百万 Token）</th>
								<th>路由状态</th>
								<th>操作</th>
							</tr>
						</thead>
						<tbody>
							{pagination.items.map((model) => (
								<tr key={model.id}>
									<td>
										<strong>{model.name}</strong>
										<small className="table-secondary mono">{model.id}</small>
									</td>
									<td className="mono">
										{formatAmount(model.inputRate, true)} /{" "}
										{formatAmount(model.outputRate, true)}
									</td>
									<td>
										<Badge tone={model.available ? "green" : "warn"}>
											{model.available ? "可路由" : "暂无可用上游"}
										</Badge>
									</td>
									<td>
										<button
											className="button small"
											disabled={busy || !signedIn}
											onClick={() => onCreateKey([model.id])}
											type="button"
										>
											创建模型 Key <ArrowRight size={12} />
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</TableScroll>
			) : (
				<Empty
					description={
						models.length
							? "调整搜索或状态筛选后重试。"
							: "管理员需先配置模型报价和上游路由。"
					}
					title={models.length ? "没有匹配的模型" : "暂无已发布模型"}
				/>
			)}
			<Pagination
				{...pagination}
				label="模型市场"
				onChange={pagination.setPage}
			/>
		</>
	);
}
