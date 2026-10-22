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
import { formatAmount as usd } from "~/shared/money";
import type { SettlementAsset } from "~/shared/settlement-asset";
import type { SessionView } from "~/shared/token2api";
import { remainingBudget, type Section, short } from "./format";
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
	sessions,
	sessionId,
	messages,
	prompt,
	navigate,
	onPromptChange,
	onSelectSession,
	onNewConversation,
	onOpenBilling,
	onSubmit,
	error,
}: {
	asset: SettlementAsset;
	busy: string | null;
	sessions: SessionView[];
	sessionId: string;
	messages: ChatMessage[];
	prompt: string;
	navigate: (section: Section) => void;
	onPromptChange: (value: string) => void;
	onSelectSession: (id: string) => void;
	onNewConversation: () => void;
	onOpenBilling: () => void;
	onSubmit: (event: FormEvent) => void;
	error: string | null;
}) {
	const selected = sessions.find((item) => item.id === sessionId);
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
					<div className="field">
						<label htmlFor="lab-session">预算会话</label>
						<ConsoleSelect
							disabled={!!busy}
							id="lab-session"
							onValueChange={onSelectSession}
							options={sessions.map((item) => ({
								value: item.id,
								label: item.listingName,
								description: `${item.model} · ${short(item.id)}`,
								icon: Wallet,
							}))}
							placeholder={
								sessions.length ? "选择使用中的会话" : "暂无可用的预算会话"
							}
							value={sessionId}
						/>
					</div>
					<div className="field">
						<label htmlFor="lab-model">模型</label>
						<input
							id="lab-model"
							readOnly
							value={selected?.model ?? "尚未选择资源"}
						/>
					</div>
					<div className="field">
						<span className="field-label">可用预算</span>
						<div
							className="stat-value"
							style={{ fontSize: 24, margin: "3px 0" }}
						>
							{selected ? usd(remainingBudget(selected), true) : "—"}
							<small>{asset}</small>
						</div>
						<small>费用先预留，再按实际用量核销。</small>
						{selected && selected.reserved > 0 && (
							<small className="pending-amount">
								已预留 {usd(selected.reserved, true)} {asset}
								，包含执行中或待核对用量。
							</small>
						)}
					</div>
					{!sessions.length && (
						<button
							className="button primary"
							onClick={() => navigate("market")}
							style={{ width: "100%", marginTop: 17 }}
							type="button"
						>
							先创建预算会话 <ArrowRight size={12} />
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
						? `${selected.listingName} / ${selected.model}`
						: "选择会话后发送第一条消息"
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
						disabled={!selected || !!busy}
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
							disabled={!selected || !prompt.trim() || !!busy}
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
