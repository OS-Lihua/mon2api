"use client";

import { Plus, RefreshCw } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ZodError } from "zod";
import { modelProductInput, modelRouteInput } from "~/shared/model-routing";
import { formatAmount, parseMicroAmount } from "~/shared/money";
import type { SettlementAsset } from "~/shared/settlement-asset";
import { api } from "~/trpc/react";
import {
	CollectionToolbar,
	Pagination,
	SearchField,
	usePagination,
} from "./console/collection";
import { Badge, Empty, Loading, Modal, Panel, QueryError } from "./console/ui";
import { ConsoleSelect } from "./console-select";

type ProductForm = {
	id: string;
	name: string;
	input: string;
	output: string;
	enabled: boolean;
	editing: boolean;
};
type RouteForm = {
	modelId: string;
	listingId: string;
	priority: number;
	enabled: boolean;
	listingName?: string;
	upstreamModel?: string;
};

export function ModelRoutingAdmin({ asset }: { asset: SettlementAsset }) {
	const query = api.token2api.operatorModels.useQuery();
	const saveModel = api.token2api.saveModel.useMutation();
	const saveRoute = api.token2api.saveModelRoute.useMutation();
	const utils = api.useUtils();
	const [product, setProduct] = useState<ProductForm | null>(null);
	const [route, setRoute] = useState<RouteForm | null>(null);
	const [search, setSearch] = useState("");
	const [resourceSearch, setResourceSearch] = useState("");
	const [resourceQuery, setResourceQuery] = useState("");
	const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const resources = api.token2api.operatorResources.useQuery(
		{ limit: 25, q: resourceQuery, gatewayOnly: true, cursor: cursors.at(-1) },
		{ enabled: !!route },
	);
	useEffect(() => {
		const timeout = window.setTimeout(() => {
			setResourceQuery(resourceSearch);
			setCursors([undefined]);
		}, 250);
		return () => window.clearTimeout(timeout);
	}, [resourceSearch]);
	const filtered = (query.data ?? []).filter((model) =>
		`${model.id} ${model.name}`
			.toLowerCase()
			.includes(search.trim().toLowerCase()),
	);
	const pagination = usePagination(filtered, 8);
	const run = async (action: () => Promise<void>) => {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			await action();
			await Promise.all([
				query.refetch(),
				utils.token2api.modelCatalog.invalidate(),
			]);
			setNotice(
				"模型配置已保存，后续请求使用新配置；已有调用继续使用其价格快照。",
			);
		} catch (cause) {
			setError(
				cause instanceof ZodError
					? (cause.issues[0]?.message ?? "请检查模型配置。")
					: cause instanceof Error
						? cause.message
						: "配置未保存，请重试。",
			);
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};
	const submitProduct = (event: FormEvent) => {
		event.preventDefault();
		if (!product) return;
		void run(async () => {
			const input = modelProductInput.parse({
				id: product.id,
				name: product.name,
				inputRate: parseMicroAmount(product.input),
				outputRate: parseMicroAmount(product.output),
				enabled: product.enabled,
			});
			if (
				!product.editing &&
				query.data?.some((model) => model.id === input.id)
			)
				throw new Error("模型 ID 已存在，请编辑现有模型。");
			await saveModel.mutateAsync(input);
			setProduct(null);
		});
	};
	const submitRoute = (event: FormEvent) => {
		event.preventDefault();
		if (!route) return;
		void run(async () => {
			await saveRoute.mutateAsync(
				modelRouteInput.parse({
					modelId: route.modelId,
					listingId: route.listingId,
					priority: route.priority,
					enabled: route.enabled,
				}),
			);
			setRoute(null);
		});
	};
	const openRoute = (value: RouteForm) => {
		setError(null);
		setResourceSearch("");
		setResourceQuery("");
		setCursors([undefined]);
		setRoute(value);
	};
	const options = (resources.data?.data ?? []).map((resource) => ({
		value: resource.id,
		label: resource.name,
		description: `${resource.model} · ${formatAmount(resource.inputRate, true)} / ${formatAmount(resource.outputRate, true)} ${asset} / 百万 Token`,
	}));
	if (
		route?.listingId &&
		!options.some((option) => option.value === route.listingId)
	)
		options.unshift({
			value: route.listingId,
			label: route.listingName ?? route.listingId,
			description: route.upstreamModel ?? "当前已配置资源",
		});
	return (
		<Panel
			action={
				<button
					className="button primary"
					disabled={busy}
					onClick={() => {
						setError(null);
						setProduct({
							id: "",
							name: "",
							input: "",
							output: "",
							enabled: true,
							editing: false,
						});
					}}
					type="button"
				>
					<Plus size={14} />
					发布模型
				</button>
			}
			subtitle={`统一报价单位 ${asset} / 百万 Token · 较小的优先级先被选择`}
			title="平台模型与路由"
		>
			<div aria-busy={busy} className="panel-body model-admin-body">
				{notice && (
					<div className="notice" role="status">
						{notice}
					</div>
				)}
				{error && !product && !route && (
					<div className="notice error" role="alert">
						{error}
					</div>
				)}
				<CollectionToolbar>
					<SearchField
						label="搜索平台模型"
						onChange={(value) => {
							setSearch(value);
							pagination.setPage(1);
						}}
						placeholder="模型名称或 ID"
						value={search}
					/>
					<button
						className="button"
						disabled={query.isFetching || busy}
						onClick={() => void query.refetch()}
						type="button"
					>
						<RefreshCw size={14} />
						刷新
					</button>
				</CollectionToolbar>
				{query.isLoading ? (
					<Loading label="正在读取模型与路由…" />
				) : query.error ? (
					<QueryError
						message={query.error.message}
						onRetry={() => void query.refetch()}
					/>
				) : !filtered.length ? (
					<Empty
						description="发布平台模型，设置输入/输出报价，再配置对应的上游资源。"
						title="暂无匹配模型"
					/>
				) : (
					pagination.items.map((model) => (
						<section className="model-admin-product" key={model.id}>
							<div className="model-admin-heading">
								<div>
									<strong>{model.name}</strong>
									<code>{model.id}</code>
									<p>
										输入 {formatAmount(model.inputRate, true)} / 输出{" "}
										{formatAmount(model.outputRate, true)} {asset} / 百万 Token
									</p>
								</div>
								<Badge tone={model.enabled ? "green" : "neutral"}>
									{model.enabled ? "已启用" : "已停用"}
								</Badge>
								<button
									className="button small"
									disabled={busy}
									onClick={() => {
										setError(null);
										setProduct({
											id: model.id,
											name: model.name,
											input: formatAmount(model.inputRate, true).replaceAll(
												",",
												"",
											),
											output: formatAmount(model.outputRate, true).replaceAll(
												",",
												"",
											),
											enabled: model.enabled,
											editing: true,
										});
									}}
									type="button"
								>
									编辑报价
								</button>
								<button
									className="button small"
									disabled={busy}
									onClick={() =>
										openRoute({
											modelId: model.id,
											listingId: "",
											priority: 100,
											enabled: true,
										})
									}
									type="button"
								>
									添加路由
								</button>
							</div>
							{model.routes.length ? (
								<ul className="model-admin-routes">
									{model.routes.map((entry) => (
										<li key={entry.id}>
											<div>
												<strong>{entry.listing.name}</strong>
												<code>{entry.listing.model}</code>
												<small>
													上游报价 {formatAmount(entry.listing.inputRate, true)}{" "}
													/ {formatAmount(entry.listing.outputRate, true)}{" "}
													{asset} / 百万 Token · 优先级 {entry.priority}
												</small>
											</div>
											<Badge
												tone={
													entry.enabled &&
													entry.listing.enabled &&
													entry.listing.inputRate <= model.inputRate &&
													entry.listing.outputRate <= model.outputRate
														? "green"
														: "warn"
												}
											>
												{!entry.enabled
													? "路由已停用"
													: !entry.listing.enabled
														? "资源未上架"
														: entry.listing.inputRate > model.inputRate ||
																entry.listing.outputRate > model.outputRate
															? "上游报价超限"
															: "参与路由"}
											</Badge>
											<button
												className="button small"
												disabled={busy}
												onClick={() =>
													openRoute({
														modelId: model.id,
														listingId: entry.listingId,
														priority: entry.priority,
														enabled: entry.enabled,
														listingName: entry.listing.name,
														upstreamModel: entry.listing.model,
													})
												}
												type="button"
											>
												管理路由
											</button>
										</li>
									))}
								</ul>
							) : (
								<p className="muted">
									暂无上游路由。该模型可以授权给 Key，但暂不能执行调用。
								</p>
							)}
						</section>
					))
				)}
				<Pagination
					{...pagination}
					label="平台模型"
					onChange={pagination.setPage}
				/>
			</div>
			{product && (
				<Modal
					busy={busy}
					error={error}
					onClose={() => !busy && setProduct(null)}
					title={product.editing ? "编辑平台模型" : "发布平台模型"}
				>
					<form onSubmit={submitProduct}>
						<div className="field">
							<label htmlFor="platform-model-id">平台模型 ID</label>
							<input
								disabled={busy}
								id="platform-model-id"
								maxLength={100}
								onChange={(event) =>
									setProduct({ ...product, id: event.target.value })
								}
								pattern={"[A-Za-z0-9_.:@\\/\\-]+"}
								readOnly={product.editing}
								required
								value={product.id}
							/>
							<small>调用方在请求中使用此 ID，上游模型名可不同。</small>
						</div>
						<div className="field">
							<label htmlFor="platform-model-name">模型名称</label>
							<input
								disabled={busy}
								id="platform-model-name"
								maxLength={100}
								onChange={(event) =>
									setProduct({ ...product, name: event.target.value })
								}
								required
								value={product.name}
							/>
						</div>
						<div className="form-grid">
							{(
								[
									["input", "输入价"],
									["output", "输出价"],
								] as const
							).map(([field, label]) => (
								<div className="field" key={field}>
									<label htmlFor={`platform-model-${field}`}>
										{label}（{asset} / 百万 Token）
									</label>
									<input
										disabled={busy}
										id={`platform-model-${field}`}
										inputMode="decimal"
										onChange={(event) =>
											setProduct({ ...product, [field]: event.target.value })
										}
										pattern="[0-9]+([.][0-9]{1,6})?"
										required
										type="text"
										value={product[field]}
									/>
								</div>
							))}
						</div>
						<label className="checkbox-label">
							<input
								checked={product.enabled}
								disabled={busy}
								onChange={(event) =>
									setProduct({ ...product, enabled: event.target.checked })
								}
								type="checkbox"
							/>
							允许新调用使用该模型
						</label>
						<p className="muted">
							平台报价低于上游报价时，该上游不受理新请求。已有调用继续按原价格结算。
						</p>
						<div className="form-actions">
							<button
								className="button"
								disabled={busy}
								onClick={() => setProduct(null)}
								type="button"
							>
								取消
							</button>
							<button className="button primary" disabled={busy} type="submit">
								{busy ? "正在保存…" : "保存模型"}
							</button>
						</div>
					</form>
				</Modal>
			)}
			{route && (
				<Modal
					busy={busy}
					error={error}
					onClose={() => !busy && setRoute(null)}
					title={`配置模型路由 · ${route.modelId}`}
				>
					<form onSubmit={submitRoute}>
						{query.data
							?.filter((model) => model.id === route.modelId)
							.map((model) => (
								<p className="muted" key={model.id}>
									平台报价：输入 {formatAmount(model.inputRate, true)} / 输出{" "}
									{formatAmount(model.outputRate, true)} {asset} / 百万
									Token。上游报价不能高于对应平台报价。
								</p>
							))}
						<SearchField
							label="搜索上游资源"
							onChange={setResourceSearch}
							placeholder="资源名称、上游模型或资源 ID"
							value={resourceSearch}
						/>
						{resources.isLoading ? (
							<Loading label="正在读取资源…" />
						) : resources.error ? (
							<QueryError
								message={resources.error.message}
								onRetry={() => void resources.refetch()}
							/>
						) : (
							<>
								<div className="field">
									<label htmlFor="route-resource">上游资源</label>
									<ConsoleSelect
										disabled={busy}
										id="route-resource"
										onValueChange={(listingId) =>
											setRoute({ ...route, listingId })
										}
										options={options}
										placeholder="选择真实网关或 pool connector 资源"
										required
										value={route.listingId}
									/>
								</div>
								<div className="collection-pagination">
									<span>第 {cursors.length} 页 · 本页最多 25 个真实资源</span>
									<button
										className="button small"
										disabled={busy || cursors.length <= 1}
										onClick={() => setCursors((value) => value.slice(0, -1))}
										type="button"
									>
										上一页
									</button>
									<button
										className="button small"
										disabled={busy || !resources.data?.hasMore}
										onClick={() =>
											setCursors((value) => [
												...value,
												resources.data?.nextCursor ?? undefined,
											])
										}
										type="button"
									>
										下一页
									</button>
								</div>
							</>
						)}
						<div className="field">
							<label htmlFor="route-priority">优先级（0–1000，较小优先）</label>
							<input
								disabled={busy}
								id="route-priority"
								max={1000}
								min={0}
								onChange={(event) =>
									setRoute({ ...route, priority: event.target.valueAsNumber })
								}
								required
								step={1}
								type="number"
								value={route.priority}
							/>
						</div>
						<label className="checkbox-label">
							<input
								checked={route.enabled}
								disabled={busy}
								onChange={(event) =>
									setRoute({ ...route, enabled: event.target.checked })
								}
								type="checkbox"
							/>
							允许该资源参与模型路由
						</label>
						<p className="muted">
							停用仅停止分配新调用，已有调用、结算及资金退回继续处理。上游需已获准且报价不高于平台报价。
						</p>
						<div className="form-actions">
							<button
								className="button"
								disabled={busy}
								onClick={() => setRoute(null)}
								type="button"
							>
								取消
							</button>
							<button
								className="button primary"
								disabled={
									busy ||
									!route.listingId ||
									resources.isLoading ||
									!!resources.error
								}
								type="submit"
							>
								{busy ? "正在保存…" : "保存路由"}
							</button>
						</div>
					</form>
				</Modal>
			)}
		</Panel>
	);
}
