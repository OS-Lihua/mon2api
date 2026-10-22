"use client";

import { useId, useState } from "react";
import type { ModelView } from "~/shared/model-routing";
import { formatAmount } from "~/shared/money";
import { SearchField } from "./collection";
import { Badge, Empty, Loading, QueryError } from "./ui";

export function ModelPicker({
	models,
	selected,
	onChange,
	asset,
	disabled,
	loading,
	error,
	onRetry,
}: {
	models: ModelView[];
	selected: string[];
	onChange: (models: string[]) => void;
	asset: string;
	disabled: boolean;
	loading?: boolean;
	error?: string | null;
	onRetry: () => void;
}) {
	const [search, setSearch] = useState("");
	const hintId = useId();
	const filtered = models.filter((model) =>
		`${model.id} ${model.name}`
			.toLowerCase()
			.includes(search.trim().toLowerCase()),
	);
	const hidden = selected.filter(
		(id) => !models.some((model) => model.id === id),
	);
	return (
		<fieldset
			aria-describedby={hintId}
			className="model-picker"
			disabled={disabled}
		>
			<legend>允许使用的模型</legend>
			<p className="muted" id={hintId}>
				选择 1–100 个模型。新增模型不会自动获得授权；上游由平台选择。
			</p>
			{!!hidden.length && (
				<div className="notice warning">
					<span>已停用的授权模型：{hidden.join("、")}</span>
					<button
						className="text-link"
						onClick={() =>
							onChange(selected.filter((id) => !hidden.includes(id)))
						}
						type="button"
					>
						移除这些授权
					</button>
				</div>
			)}
			{loading ? (
				<Loading label="正在读取模型…" />
			) : error ? (
				<QueryError message={error} onRetry={onRetry} />
			) : !models.length ? (
				<Empty
					description="管理员发布模型与统一报价后，可在此授权。"
					title="暂无已发布模型"
				/>
			) : (
				<>
					<SearchField
						label="搜索可授权模型"
						onChange={setSearch}
						placeholder="模型名称或 ID"
						value={search}
					/>
					<div className="model-picker-actions">
						<span className="model-picker-count">
							{selected.length} 个模型已授权
						</span>
						<button
							className="text-link"
							onClick={() =>
								onChange(models.slice(0, 100).map((model) => model.id))
							}
							type="button"
						>
							{models.length > 100 ? "选择前 100 个模型" : "选择当前全部模型"}
						</button>
						<button
							className="text-link"
							onClick={() => onChange([])}
							type="button"
						>
							清空
						</button>
					</div>
					<div className="model-picker-list">
						{filtered.map((model) => (
							<label className="model-option" key={model.id}>
								<input
									checked={selected.includes(model.id)}
									className="model-checkbox"
									disabled={
										selected.length >= 100 && !selected.includes(model.id)
									}
									onChange={(event) =>
										onChange(
											event.target.checked
												? [...selected, model.id]
												: selected.filter((id) => id !== model.id),
										)
									}
									type="checkbox"
								/>
								<span>
									<strong>{model.name}</strong>
									<code>{model.id}</code>
									<small>
										输入 {formatAmount(model.inputRate, true)} / 输出{" "}
										{formatAmount(model.outputRate, true)} {asset} / 百万 Token
									</small>
								</span>
								<Badge tone={model.available ? "green" : "warn"}>
									{model.available ? "可路由" : "暂无可用上游"}
								</Badge>
							</label>
						))}
					</div>
					{!filtered.length && (
						<Empty description="调整搜索后重试。" title="没有匹配的模型" />
					)}
				</>
			)}
		</fieldset>
	);
}
