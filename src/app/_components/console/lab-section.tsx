"use client";

import {
	ArrowRight,
	LoaderCircle,
	Network,
	RefreshCw,
	Send,
	Sparkles,
	Wallet,
} from "lucide-react";
import { type FormEvent, useEffect, useRef } from "react";
import { ConsoleSelect } from "~/app/_components/console-select";
import type { ModelView } from "~/shared/model-routing";
import { formatAmount as usd } from "~/shared/money";
import type { SettlementAsset } from "~/shared/settlement-asset";
import type { KeyView } from "~/shared/token2api";
import type { Section } from "./format";
import { Badge, Empty, Panel } from "./ui";

export type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	meta?: string;
	finishReason?: "stop" | "length" | "content_filter";
};

export function LabSection({
	asset,
	busy,
	keys,
	keyId,
	models,
	modelId,
	balance,
	messages,
	prompt,
	navigate,
	onPromptChange,
	onSelectKey,
	onSelectModel,
	onNewConversation,
	onOpenBilling,
	onSubmit,
	error,
}: {
	asset: SettlementAsset;
	busy: string | null;
	keys: KeyView[];
	keyId: string;
	models: ModelView[];
	modelId: string;
	balance: number | null;
	messages: ChatMessage[];
	prompt: string;
	navigate: (section: Section) => void;
	onPromptChange: (value: string) => void;
	onSelectKey: (id: string) => void;
	onSelectModel: (model: string) => void;
	onNewConversation: () => void;
	onOpenBilling: () => void;
	onSubmit: (event: FormEvent) => void;
	error: string | null;
}) {
	const selected = keys.find((item) => item.id === keyId);
	const messagesRef = useRef<HTMLDivElement>(null);
	const messageCount = messages.length;
	useEffect(() => {
		void messageCount;
		void busy;
		const container = messagesRef.current;
		if (container) container.scrollTop = container.scrollHeight;
	}, [messageCount, busy]);
	return (
		<div className="chat-layout">
			<Panel className="chat-settings" title="调用配置">
				<div className="panel-body">
					<div className="field lab-selector">
						<label htmlFor="lab-key">API Key</label>
						<ConsoleSelect
							disabled={!!busy}
							id="lab-key"
							onValueChange={onSelectKey}
							options={keys.map((key) => ({
								value: key.id,
								label: key.name,
								description: key.prefix,
								icon: Wallet,
							}))}
							placeholder="选择模型 Key"
							value={keyId}
						/>
					</div>
					<div className="field lab-selector">
						<label htmlFor="lab-model">模型</label>
						<ConsoleSelect
							disabled={!!busy || !selected}
							id="lab-model"
							onValueChange={onSelectModel}
							options={models.map((model) => ({
								value: model.id,
								label: model.name,
								description: `${model.id}${model.available ? "" : " · 暂无可用上游"}`,
							}))}
							placeholder="选择此 Key 已授权的模型"
							value={modelId}
						/>
					</div>
					<div className="field lab-balance">
						<span className="field-label">账户可用余额</span>
						<div
							className="stat-value"
							style={{ fontSize: 24, margin: "3px 0" }}
						>
							{balance === null ? "—" : usd(balance, true)}
							<small>{asset}</small>
						</div>
						<small>费用先预留，再按统一模型报价核销。上游由平台选择。</small>
						<button
							className="text-link"
							onClick={() => navigate("billing")}
							type="button"
						>
							余额与充值 <ArrowRight size={12} />
						</button>
					</div>
					{!keys.length && (
						<button
							className="button primary"
							onClick={() => navigate("keys")}
							type="button"
						>
							先创建模型 Key <ArrowRight size={12} />
						</button>
					)}
				</div>
			</Panel>
			<Panel
				action={
					<button
						className="text-link"
						disabled={!!busy}
						onClick={onNewConversation}
						type="button"
					>
						<RefreshCw size={10} />
						新对话
					</button>
				}
				className="chat-window"
				subtitle={
					selected
						? `${selected.name} / ${modelId || "选择模型"}`
						: "选择 Key 和已授权模型后发送消息"
				}
				title="对话终端"
			>
				<div className="lab-status" role="status">
					<Badge
						tone={
							busy === "chat" || error
								? "warn"
								: messages.length
									? "green"
									: "neutral"
						}
					>
						{busy === "chat"
							? "执行中"
							: error
								? "调用未完成"
								: messages.length
									? "已收到响应"
									: "准备就绪"}
					</Badge>
					<span>整段响应 · 输出上限 512 Token</span>
				</div>
				<div
					aria-busy={busy === "chat"}
					aria-live="polite"
					className="chat-messages"
					ref={messagesRef}
				>
					{!messages.length && busy !== "chat" ? (
						<Empty
							description="发送请求后等待完整响应，再核对用量与费用。"
							icon={Sparkles}
							title="开始对话"
						>
							<div className="prompt-suggestions">
								{[
									"用三句话解释 Token2API 的预算与结算。",
									"写一个简短的 TypeScript 函数示例。",
								].map((value) => (
									<button
										className="button small"
										disabled={!!busy}
										key={value}
										onClick={() => onPromptChange(value)}
										type="button"
									>
										{value}
									</button>
								))}
							</div>
						</Empty>
					) : (
						messages.map((message) => (
							<div className={`chat-message ${message.role}`} key={message.id}>
								<div className="chat-message-label">
									{message.role === "user" ? (
										<Wallet size={11} />
									) : (
										<Network size={11} />
									)}
									{message.role === "user" ? "YOU" : "Token2API / RESPONSE"}
								</div>
								<p>{message.content}</p>
								{message.meta && (
									<div className="chat-message-meta mono">{message.meta}</div>
								)}
							</div>
						))
					)}
					{messages.some((message) => message.role === "assistant") && (
						<div className="chat-billing-link">
							<span>可在账单中核对费用与结算状态。</span>
							<button
								className="text-link"
								onClick={onOpenBilling}
								type="button"
							>
								查看调用账单 <ArrowRight size={12} />
							</button>
						</div>
					)}
					{busy === "chat" && (
						<>
							<div className="chat-message user">
								<div className="chat-message-label">
									<Wallet size={12} />
									本次请求
								</div>
								<p>{prompt.trim()}</p>
							</div>
							<div className="chat-message-label">
								<LoaderCircle className="spin" size={14} />
								正在等待完整响应，用量与费用尚未确认。
							</div>
						</>
					)}
					{error && busy !== "chat" && (
						<div className="notice warning">
							<span>
								请求未完成。消息已保留；用量可能仍在核对，请先查看账单再决定是否发起新调用。
							</span>
							<button
								className="text-link"
								onClick={onOpenBilling}
								type="button"
							>
								查看调用账单
							</button>
						</div>
					)}
				</div>
				<form className="chat-composer" onSubmit={onSubmit}>
					<label className="sr-only" htmlFor="prompt">
						消息内容
					</label>
					<textarea
						disabled={!selected || !modelId || !!busy}
						id="prompt"
						maxLength={8000}
						onChange={(event) => onPromptChange(event.target.value)}
						onKeyDown={(event) => {
							if (
								event.key === "Enter" &&
								(event.ctrlKey || event.metaKey) &&
								!event.nativeEvent.isComposing
							) {
								event.preventDefault();
								event.currentTarget.form?.requestSubmit();
							}
						}}
						placeholder="输入你的消息…"
						value={prompt}
					/>
					<div className="chat-composer-bottom">
						<span>{prompt.length} / 8,000 字符 · Ctrl / ⌘ + Enter 发送</span>
						<button
							className="button primary"
							disabled={!selected || !modelId || !prompt.trim() || !!busy}
							type="submit"
						>
							{busy === "chat" ? (
								<LoaderCircle className="spin" size={12} />
							) : (
								<Send size={12} />
							)}
							{busy === "chat" ? "等待响应…" : "发送请求"}
						</button>
					</div>
				</form>
			</Panel>
		</div>
	);
}
