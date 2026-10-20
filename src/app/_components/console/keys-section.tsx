"use client";

import { ArrowRight, Check, Copy, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import type { BuyerConnection, Snapshot } from "~/shared/token2api";
import { date, type Section, short } from "./format";
import { Badge, Empty, Panel, ShowAllToggle, TableScroll } from "./ui";

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
	const [showAllKeys, setShowAllKeys] = useState(false);
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
				action={
					<ShowAllToggle
						collapseLabel="收起密钥"
						count={data.keys.length}
						expanded={showAllKeys}
						expandLabel={`查看全部 ${data.keys.length} 个密钥`}
						limit={8}
						onToggle={() => setShowAllKeys((value) => !value)}
					/>
				}
				subtitle="绑定预算会话，撤销后停止新请求"
				title="应用密钥"
			>
				{data.keys.length ? (
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
								{(showAllKeys ? data.keys : data.keys.slice(0, 8)).map(
									(item) => (
										<tr key={item.id}>
											<td>{item.name}</td>
											<td className="mono">{item.prefix}••••••••</td>
											<td className="mono">{short(item.sessionId)}</td>
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
													onClick={() => onRevoke(item.id)}
													type="button"
												>
													撤销密钥
												</button>
											</td>
										</tr>
									),
								)}
							</tbody>
						</table>
					</TableScroll>
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
			</Panel>
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
