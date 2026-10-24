"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ArrowLeft, Globe2, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { BrandLogo } from "~/app/_components/brand-logo";
import {
	CollectionToolbar,
	FilterField,
	Pagination,
	SearchField,
	usePagination,
} from "~/app/_components/console/collection";
import { date, sameAddress, short } from "~/app/_components/console/format";
import {
	Badge,
	Empty,
	Loading,
	Modal,
	Panel,
	QueryError,
} from "~/app/_components/console/ui";
import { ConsoleSelect } from "~/app/_components/console-select";
import { useToken2ApiWallet } from "~/app/_components/wallet-provider";
import { endpointPolicyInput } from "~/shared/gateway-config";
import { uiPreview } from "~/shared/ui-preview";
import { api } from "~/trpc/react";
import { ModelRoutingAdmin } from "./model-routing-admin";

export function Token2ApiAdmin() {
	const { address, isConnected } = useToken2ApiWallet();
	const snapshot = api.token2api.snapshot.useQuery({ gatewayOnly: true });
	const viewer = snapshot.data?.viewer;
	const status = api.token2api.operatorStatus.useQuery(undefined, {
		enabled: !uiPreview,
		retry: false,
		refetchInterval: 10_000,
	});
	const refreshStatus = status.refetch;
	useEffect(() => {
		if (!uiPreview && viewer?.address) void refreshStatus();
	}, [viewer?.address, refreshStatus]);
	const authorized =
		!uiPreview &&
		!!status.data?.authorized &&
		!!viewer &&
		!viewer.demo &&
		isConnected &&
		sameAddress(address, viewer.address) &&
		sameAddress(address, status.data.owner);
	return (
		<div className="admin-shell">
			<header className="topbar">
				<div className="admin-navigation">
					<Link aria-label="Token2API 首页" href="/">
						<BrandLogo />
					</Link>
					<a className="text-link" href="/console">
						<ArrowLeft size={14} /> 返回控制台
					</a>
				</div>
				{uiPreview ? (
					<span className="demo-pill">UI 预览</span>
				) : (
					<ConnectButton
						accountStatus="address"
						label="连接管理员钱包"
						showBalance={false}
					/>
				)}
			</header>
			<main className="content">
				<div className="page-heading">
					<div>
						<span className="workspace-caption">TOKEN2API · 管理后台</span>
						<h1>平台管理</h1>
						<p className="workspace-description">
							配置模型报价与上游路由，审核接入地址和关联资源。
						</p>
					</div>
					<ShieldCheck size={30} strokeWidth={1.4} />
				</div>
				{authorized && snapshot.data ? (
					<>
						<ModelRoutingAdmin
							asset={snapshot.data.network.asset}
							key={`models:${viewer.address}`}
						/>
						<EndpointManager key={viewer.address} />
					</>
				) : (
					<Panel
						subtitle="使用当前托管合约的 owner 钱包连接并签名登录。"
						title="管理员身份验证"
					>
						<Empty
							description={
								uiPreview
									? "UI 预览不连接钱包。请在正常运行环境连接管理员钱包并签名验证。"
									: status.error
										? status.error.message
										: "普通商家和调用者不能读取或修改后台数据。"
							}
							icon={ShieldCheck}
							title={
								uiPreview
									? "预览模式不执行管理员操作"
									: status.isFetching
										? "正在验证管理员身份"
										: status.error
											? "暂时无法验证管理员身份"
											: "需要管理员钱包"
							}
						>
							{status.data && (
								<p className="admin-owner">
									当前管理员：<span className="mono">{status.data.owner}</span>
								</p>
							)}
							<button
								className="button"
								disabled={uiPreview || status.isFetching}
								onClick={() => {
									void snapshot.refetch();
									void status.refetch();
								}}
								type="button"
							>
								重新验证
							</button>
						</Empty>
					</Panel>
				)}
			</main>
		</div>
	);
}

function EndpointManager() {
	const policies = api.token2api.endpointPolicies.useQuery(undefined, {
		retry: false,
		refetchInterval: 15_000,
	});
	const [endpointId, setEndpointId] = useState<string>();
	const [cursor, setCursor] = useState<string>();
	const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>(
		[],
	);
	const resources = api.token2api.operatorResources.useQuery(
		{ endpointId, cursor, limit: 25 },
		{ retry: false },
	);
	const save = api.token2api.saveEndpointPolicy.useMutation();
	const toggle = api.token2api.setEndpointStatus.useMutation();
	const [kind, setKind] = useState<"GATEWAY" | "PROXY">("GATEWAY");
	const [url, setUrl] = useState("");
	const [name, setName] = useState("");
	const [note, setNote] = useState("");
	const [editing, setEditing] = useState(false);
	const [formOpen, setFormOpen] = useState(false);
	const [fieldErrors, setFieldErrors] = useState<{
		url?: string[];
		name?: string[];
		note?: string[];
	}>({});
	const [search, setSearch] = useState("");
	const [statusFilter, setStatusFilter] = useState("all");
	const [kindFilter, setKindFilter] = useState("all");
	type Endpoint = NonNullable<typeof policies.data>[number];
	const [pendingDisable, setPendingDisable] = useState<Endpoint | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const busy = save.isPending || toggle.isPending;
	const submitting = useRef(false);
	const refresh = async () => {
		await Promise.all([policies.refetch(), resources.refetch()]);
	};
	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (busy || submitting.current) return;
		setError(null);
		setNotice(null);
		setFieldErrors({});
		const parsed = endpointPolicyInput.safeParse({ kind, url, name, note });
		if (!parsed.success) {
			const validation = parsed.error.flatten();
			setFieldErrors({
				...validation.fieldErrors,
				...(validation.formErrors.length ? { url: validation.formErrors } : {}),
			});
			setError(parsed.error.issues[0]?.message ?? "请检查表单内容。");
			document
				.getElementById(
					`endpoint-${parsed.error.issues[0]?.path[0] === "name" ? "name" : "url"}`,
				)
				?.focus();
			return;
		}
		submitting.current = true;
		try {
			await save.mutateAsync(parsed.data);
			setUrl("");
			setName("");
			setNote("");
			setEditing(false);
			setFormOpen(false);
			setNotice("白名单记录已保存。已有停用记录不会自动启用。");
			await refresh();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "保存失败。");
		} finally {
			submitting.current = false;
		}
	};
	const changeStatus = async (id: string, enabled: boolean) => {
		if (busy || submitting.current) return;
		submitting.current = true;
		setError(null);
		setNotice(null);
		try {
			await toggle.mutateAsync({ id, enabled });
			setPendingDisable(null);
			setNotice(
				enabled
					? "地址已启用。关联资源需由商家重新上架。"
					: "地址已停用，关联直连资源已停止新接单；已有结算和退款可继续。",
			);
			await refresh();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "操作失败。");
		} finally {
			submitting.current = false;
		}
	};
	const entries =
		policies.data
			?.filter(
				(entry) =>
					`${entry.name} ${entry.url} ${entry.note}`
						.toLowerCase()
						.includes(search.trim().toLowerCase()) &&
					(statusFilter === "all" ||
						(statusFilter === "enabled" ? entry.enabled : !entry.enabled)) &&
					(kindFilter === "all" || entry.kind === kindFilter),
			)
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) ??
		[];
	const pagination = usePagination(entries, 10);
	const selected = policies.data?.find((entry) => entry.id === endpointId);
	const selectEndpoint = (id?: string) => {
		setEndpointId(id);
		setCursor(undefined);
		setCursorHistory([]);
		window.requestAnimationFrame(() => {
			const heading = document.querySelector<HTMLHeadingElement>(
				"#admin-resources h2",
			);
			heading?.focus();
			heading?.scrollIntoView({ block: "start" });
		});
	};
	return (
		<div className="admin-sections">
			{error && !formOpen && !pendingDisable && (
				<div className="admin-message error" role="alert">
					{error}
				</div>
			)}
			{notice && (
				<div className="admin-message" role="status">
					{notice}
				</div>
			)}
			<div className="admin-overview">
				<div>
					<strong>{policies.data?.length ?? "—"}</strong>
					<span>白名单地址</span>
				</div>
				<div>
					<strong>
						{policies.data?.filter((entry) => entry.enabled).length ?? "—"}
					</strong>
					<span>已启用地址</span>
				</div>
				<button
					className="button primary"
					onClick={() => {
						setEditing(false);
						setUrl("");
						setName("");
						setNote("");
						setError(null);
						setFieldErrors({});
						setFormOpen(true);
					}}
					type="button"
				>
					<Plus size={16} />
					新增地址
				</button>
			</div>
			{formOpen && (
				<Modal
					busy={busy}
					error={error}
					onClose={() => setFormOpen(false)}
					title={editing ? "编辑白名单说明" : "新增白名单地址"}
				>
					<p className="code-hint">
						网关按完整 API
						基础地址匹配；代理按协议、主机和端口匹配。请先核对地址，再保存审核结果。
					</p>
					<form onSubmit={(event) => void submit(event)}>
						<div className="field-row">
							<div className="field">
								<label htmlFor="endpoint-kind">地址类型</label>
								<ConsoleSelect
									disabled={editing || busy}
									id="endpoint-kind"
									onValueChange={(value) =>
										setKind(value === "PROXY" ? "PROXY" : "GATEWAY")
									}
									options={[
										{ value: "GATEWAY", label: "网关 API 地址" },
										{ value: "PROXY", label: "网络代理地址" },
									]}
									value={kind}
								/>
							</div>
							<div className="field">
								<label htmlFor="endpoint-name">名称</label>
								<input
									aria-describedby={
										fieldErrors.name ? "endpoint-name-error" : undefined
									}
									aria-invalid={!!fieldErrors.name}
									disabled={busy}
									id="endpoint-name"
									maxLength={64}
									onChange={(event) => setName(event.target.value)}
									placeholder="便于识别的服务名称"
									required
									value={name}
								/>
								{fieldErrors.name && (
									<small className="field-error" id="endpoint-name-error">
										{fieldErrors.name[0]}
									</small>
								)}
							</div>
						</div>
						<div className="field">
							<label htmlFor="endpoint-url">
								{kind === "GATEWAY" ? "API 基础地址" : "代理地址"}
							</label>
							<input
								aria-describedby="endpoint-url-help"
								aria-invalid={!!fieldErrors.url}
								disabled={editing || busy}
								id="endpoint-url"
								maxLength={2048}
								onChange={(event) => setUrl(event.target.value)}
								placeholder={
									kind === "GATEWAY"
										? "https://gateway.example.com/v1"
										: "http://proxy.example.com:8080"
								}
								required
								type="url"
								value={url}
							/>
							<small id="endpoint-url-help">
								{kind === "GATEWAY"
									? "远程网关使用 HTTPS。裸域名按 /v1 处理；自定义 API 路径须单独批准。"
									: "支持 HTTP/HTTPS，不填写用户名和密码。代理凭证由商家在接入资源时单独填写。"}
							</small>
						</div>
						<div className="field">
							<label htmlFor="endpoint-note">备注（选填）</label>
							<input
								disabled={busy}
								id="endpoint-note"
								maxLength={300}
								onChange={(event) => setNote(event.target.value)}
								placeholder="审核说明或服务用途"
								value={note}
							/>
						</div>
						<div className="admin-actions">
							<button className="button primary" disabled={busy} type="submit">
								{save.isPending ? "保存中…" : "保存白名单"}
							</button>
							{editing && (
								<button
									className="button"
									disabled={busy}
									onClick={() => {
										setFormOpen(false);
										setEditing(false);
										setUrl("");
										setName("");
										setNote("");
									}}
									type="button"
								>
									取消编辑
								</button>
							)}
						</div>
					</form>
				</Modal>
			)}
			{pendingDisable && (
				<Modal
					busy={busy}
					error={error}
					onClose={() => setPendingDisable(null)}
					title="停用接入地址"
				>
					<p>确认停用「{pendingDisable.name}」？</p>
					<p className="admin-url mono">{pendingDisable.url}</p>
					<p className="code-hint">
						该地址关联 {pendingDisable.resourceCount}{" "}
						个资源。停用后，关联直连资源停止新接单；已受理调用、结算和退款继续处理。再次启用后，资源仍需由商家重新上架。
					</p>
					<div className="form-actions">
						<button
							className="button"
							disabled={busy}
							onClick={() => setPendingDisable(null)}
							type="button"
						>
							取消
						</button>
						<button
							className="button danger"
							disabled={busy}
							onClick={() => void changeStatus(pendingDisable.id, false)}
							type="button"
						>
							{busy ? "正在停用…" : "确认停用"}
						</button>
					</div>
				</Modal>
			)}
			<Panel
				action={
					<button
						className="button"
						disabled={policies.isFetching}
						onClick={() => void refresh()}
						type="button"
					>
						<RefreshCw size={13} /> 刷新
					</button>
				}
				subtitle="停用后不会中断已受理的调用，也不会阻止账单结算和资金退出。"
				title="地址白名单"
			>
				<CollectionToolbar>
					<SearchField
						label="搜索白名单"
						onChange={(value) => {
							setSearch(value);
							pagination.setPage(1);
						}}
						placeholder="名称、地址或备注"
						value={search}
					/>
					<FilterField
						id="endpoint-status-filter"
						label="白名单状态"
						onChange={(value) => {
							setStatusFilter(value);
							pagination.setPage(1);
						}}
						options={[
							{ value: "all", label: "全部状态" },
							{ value: "enabled", label: "已启用" },
							{ value: "disabled", label: "已停用" },
						]}
						value={statusFilter}
					/>
					<FilterField
						id="endpoint-kind-filter"
						label="白名单地址类型"
						onChange={(value) => {
							setKindFilter(value);
							pagination.setPage(1);
						}}
						options={[
							{ value: "all", label: "全部地址类型" },
							{ value: "GATEWAY", label: "网关地址" },
							{ value: "PROXY", label: "代理地址" },
						]}
						value={kindFilter}
					/>
				</CollectionToolbar>
				{policies.isPending ? (
					<Loading label="正在读取白名单…" />
				) : policies.isError ? (
					<QueryError
						message={policies.error.message}
						onRetry={() => void policies.refetch()}
					/>
				) : !entries.length ? (
					<Empty
						description="先添加网关地址；需要代理时，再添加代理地址。"
						icon={Globe2}
						title={
							search || statusFilter !== "all" || kindFilter !== "all"
								? "没有匹配的地址"
								: "尚未批准任何地址"
						}
					/>
				) : (
					<div className="admin-endpoints">
						{pagination.items.map((entry) => (
							<article
								className={`admin-endpoint ${endpointId === entry.id ? "selected" : ""}`}
								key={entry.id}
							>
								<div className="admin-endpoint-title">
									<strong>{entry.name}</strong>
									<Badge tone={entry.enabled ? "green" : "neutral"}>
										{entry.enabled ? "已启用" : "已停用"}
									</Badge>
									<span className="admin-kind">
										{entry.kind === "GATEWAY" ? "网关" : "代理"}
									</span>
								</div>
								<div className="admin-url mono">{entry.url}</div>
								{entry.note && <p>{entry.note}</p>}
								<div className="admin-endpoint-footer">
									<small>
										更新于 {date(entry.updatedAt)} · {short(entry.updatedBy)}
									</small>
									<div className="admin-actions">
										<button
											className="text-link"
											onClick={() => selectEndpoint(entry.id)}
											type="button"
										>
											关联资源（{entry.resourceCount}）
										</button>
										<button
											className="button"
											disabled={busy}
											onClick={() => {
												setKind(entry.kind === "PROXY" ? "PROXY" : "GATEWAY");
												setUrl(entry.url);
												setName(entry.name);
												setNote(entry.note);
												setEditing(true);
												setError(null);
												setFieldErrors({});
												setFormOpen(true);
											}}
											type="button"
										>
											编辑说明
										</button>
										<button
											className="button"
											disabled={busy}
											onClick={() => {
												if (entry.enabled) {
													setError(null);
													setPendingDisable(entry);
												} else void changeStatus(entry.id, true);
											}}
											type="button"
										>
											{entry.enabled ? "停用" : "启用"}
										</button>
									</div>
								</div>
							</article>
						))}
					</div>
				)}
				{!policies.isPending && !policies.isError && (
					<Pagination
						{...pagination}
						label="地址白名单"
						onChange={pagination.setPage}
					/>
				)}
			</Panel>
			<Panel
				action={
					endpointId ? (
						<button
							className="text-link"
							onClick={() => selectEndpoint()}
							type="button"
						>
							查看全部资源
						</button>
					) : undefined
				}
				id="admin-resources"
				subtitle="本机连接器的真实上游在商家机器上，不属于平台直连地址核验范围。"
				title={selected ? `关联资源 · ${selected.name}` : "全部资源"}
			>
				{resources.isPending ? (
					<Loading label="正在读取资源…" />
				) : resources.isError ? (
					<QueryError
						message={resources.error.message}
						onRetry={() => void resources.refetch()}
					/>
				) : !resources.data?.data.length ? (
					<Empty title="暂无资源" />
				) : (
					<div className="admin-resources">
						{resources.data.data.map((resource) => (
							<article className="admin-resource" key={resource.id}>
								<div>
									<strong>{resource.name}</strong>
									<span className="admin-kind">
										{resource.transport === "local"
											? "本机连接器 · 上游未核验"
											: "平台直连"}
									</span>
									<p className="mono admin-url">
										{resource.baseUrl ?? (resource.model || "模型尚未选择")}
									</p>
									<small>
										商家 {short(resource.owner)} · {resource._count.sessions}{" "}
										个消费会话
										{resource.proxyUrl ? ` · 代理 ${resource.proxyUrl}` : ""}
									</small>
								</div>
								<Badge
									tone={
										resource.status === "BLOCKED"
											? "warn"
											: resource.enabled
												? "green"
												: "neutral"
									}
								>
									{resource.status === "BLOCKED"
										? "白名单已停用"
										: resource.enabled
											? "已上架"
											: "未上架"}
								</Badge>
							</article>
						))}
					</div>
				)}
				{(cursor || resources.data?.hasMore) && (
					<div className="panel-body admin-actions">
						<span className="search-results">
							第 {cursorHistory.length + 1} 页 · 每页最多 25 个资源
						</span>
						<button
							className="button"
							disabled={!cursor || resources.isFetching}
							onClick={() => {
								setCursor(cursorHistory.at(-1));
								setCursorHistory((history) => history.slice(0, -1));
							}}
							type="button"
						>
							上一页
						</button>
						<button
							className="button"
							disabled={!resources.data?.hasMore || resources.isFetching}
							onClick={() => {
								setCursorHistory((history) => [...history, cursor]);
								setCursor(resources.data?.nextCursor ?? undefined);
							}}
							type="button"
						>
							下一页
						</button>
					</div>
				)}
			</Panel>
		</div>
	);
}
