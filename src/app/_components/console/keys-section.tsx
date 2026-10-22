"use client";

import { ArrowRight, Check, Copy, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import type { BuyerConnection, KeyView, Snapshot } from "~/shared/token2api";
import {
	CollectionToolbar,
	FilterField,
	Pagination,
	SearchField,
	usePagination,
} from "./collection";
import { date, type Section, short } from "./format";
import { Badge, Empty, Modal, Panel, TableScroll } from "./ui";

export function KeysSection({
	data,
	busy,
	copied,
	hasSessions,
	model,
	newKey,
	navigate,
	onCopy,
	onCreateKey,
	onRevoke,
}: {
	data: Snapshot;
	busy: boolean;
	copied: boolean;
	hasSessions: boolean;
	model: string | undefined;
	newKey: BuyerConnection | null;
	navigate: (section: Section) => void;
	onCopy: (value: string) => void;
	onCreateKey: () => void;
	onRevoke: (id: string) => void;
}) {
	const [search, setSearch] = useState("");
	const [status, setStatus] = useState("all");
	const [revoking, setRevoking] = useState<KeyView | null>(null);
	const keys = data.keys
		.filter(
			(item) =>
				`${item.name} ${item.prefix} ${item.sessionId}`
					.toLowerCase()
					.includes(search.trim().toLowerCase()) &&
				(status === "all" ||
					(status === "active" ? !item.revoked : item.revoked)),
		)
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
	const pagination = usePagination(keys);
	const baseUrl =
		newKey?.base_url ??
		(typeof window === "undefined" ? "/v1" : `${window.location.origin}/v1`);
	return (
		<>
			{newKey && (
				<div className="key-reveal" role="status">
					<p>预算已开通。API Key 仅显示一次，请立即保存。</p>
					{(
						[
							["Base URL", newKey.base_url],
							["API Key", newKey.key],
							["模型名", newKey.model],
						] as const
					).map(([label, value]) => (
						<div key={label}>
							<strong>{label}</strong>
							<code
								className="mono"
								style={{ overflowWrap: "anywhere", minWidth: 0 }}
							>
								{value}
							</code>
							<button
								aria-label={`复制${label}`}
								className="icon-button"
								onClick={() => onCopy(value)}
								type="button"
							>
								{copied ? <Check size={13} /> : <Copy size={13} />}
							</button>
						</div>
					))}
					<button
						className="button"
						onClick={() =>
							onCopy(
								JSON.stringify(
									{
										base_url: newKey.base_url,
										api_key: newKey.key,
										model: newKey.model,
									},
									null,
									2,
								),
							)
						}
						type="button"
					>
						复制全部配置
					</button>
					<p>
						当前支持文本 Chat Completions。每次新调用须携带不同的
						Idempotency-Key；同一次调用重试复用原键。
					</p>
				</div>
			)}
			<Panel
				subtitle={`绑定预算会话 · 当前返回 ${data.keys.length} 个密钥· 撤销后停止新请求`}
				title="应用密钥"
			>
				<CollectionToolbar>
					<SearchField
						label="搜索 API 密钥"
						onChange={(value) => {
							setSearch(value);
							pagination.setPage(1);
						}}
						placeholder="名称、密钥前缀或会话 ID"
						value={search}
					/>
					<FilterField
						id="keys-status"
						label="密钥状态"
						onChange={(value) => {
							setStatus(value);
							pagination.setPage(1);
						}}
						options={[
							{ value: "all", label: "全部状态" },
							{ value: "active", label: "有效密钥" },
							{ value: "revoked", label: "已撤销" },
						]}
						value={status}
					/>
				</CollectionToolbar>
				{keys.length ? (
					<TableScroll>
						<table>
							<thead>
								<tr>
									<th>密钥名称</th>
									<th>密钥前缀</th>
									<th>预算会话</th>
									<th>创建时间</th>
									<th>状态</th>
									<th>操作</th>
								</tr>
							</thead>
							<tbody>
								{pagination.items.map((item) => (
									<tr key={item.id}>
										<td>{item.name}</td>
										<td className="mono">{item.prefix}••••••••</td>
										<td className="mono" title={item.sessionId}>
											{short(item.sessionId)}
											<small className="table-secondary">
												{data.sessions.find(
													(session) => session.id === item.sessionId,
												)?.listingName ?? "关联预算会话"}
											</small>
										</td>
										<td>{date(item.createdAt)}</td>
										<td>
											<Badge tone={item.revoked ? "neutral" : "green"}>
												{item.revoked ? "已撤销" : "有效"}
											</Badge>
										</td>
										<td>
											<button
												className="button small danger"
												disabled={item.revoked || busy}
												onClick={() => setRevoking(item)}
												type="button"
											>
												撤销密钥
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</TableScroll>
				) : data.keys.length ? (
					<Empty
						description="调整搜索或状态筛选后重试。"
						title="没有匹配的密钥"
					>
						<button
							className="button"
							onClick={() => {
								setSearch("");
								setStatus("all");
								pagination.setPage(1);
							}}
							type="button"
						>
							重置筛选
						</button>
					</Empty>
				) : (
					<Empty
						description={
							hasSessions
								? "创建密钥后，完整内容只显示一次，请立即保存。"
								: "先在资源市场创建预算会话，再为应用创建独立密钥。"
						}
						icon={KeyRound}
						title={hasSessions ? "为应用创建密钥" : "先创建预算会话"}
					>
						<button
							className="button primary"
							onClick={() => (hasSessions ? onCreateKey() : navigate("market"))}
							type="button"
						>
							{hasSessions ? <Plus size={16} /> : <ArrowRight size={16} />}
							{hasSessions ? "创建第一个密钥" : "查看资源市场"}
						</button>
					</Empty>
				)}
				<Pagination
					{...pagination}
					label="API 密钥"
					onChange={pagination.setPage}
				/>
			</Panel>
			{revoking && (
				<Modal onClose={() => setRevoking(null)} title="撤销 API 密钥">
					<p>确认撤销「{revoking.name}」？</p>
					<p className="code-hint">
						撤销后，该密钥不能再发起新调用。已受理的调用、预算会话和结算继续处理。如需恢复调用，请创建新密钥。
					</p>
					<div className="form-actions">
						<button
							className="button"
							onClick={() => setRevoking(null)}
							type="button"
						>
							取消
						</button>
						<button
							className="button danger"
							disabled={busy}
							onClick={() => {
								onRevoke(revoking.id);
								setRevoking(null);
							}}
							type="button"
						>
							确认撤销
						</button>
					</div>
				</Modal>
			)}
			<div style={{ height: 22 }} />
			<Panel subtitle="兼容 OpenAI Chat Completions" title="快速接入">
				<div className="panel-body">
					<pre className="code-block mono">{`curl ${baseUrl}/chat/completions \\\n  -H "Authorization: Bearer $TOKEN2API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: example-request-0001" \\\n  -d '{\n    "model": "${model ?? "YOUR_MODEL_ID"}",\n    "messages": [{"role":"user","content":"Hello"}],\n    "stream": true\n  }'`}</pre>
					<p className="code-hint">
						Base URL 使用当前平台地址。API
						密钥绑定预算会话与资源，请保存在服务端。 每次新调用更换
						Idempotency-Key；核对同一次调用时复用原键，响应丢失后不要用新键重试。
					</p>
				</div>
			</Panel>
		</>
	);
}
