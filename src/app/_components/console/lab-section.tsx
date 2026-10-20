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
import type { FormEvent } from "react";
import { ConsoleSelect } from "~/app/_components/console-select";
import { formatAmount as usd } from "~/shared/money";
import type { SettlementAsset } from "~/shared/settlement-asset";
import type { SessionView } from "~/shared/token2api";
import { remainingBudget, type Section, short } from "./format";
import { Empty, Panel } from "./ui";

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
}) {
	const selected = sessions.find((item) => item.id === sessionId);
	return (
		<div className="chat-layout">
			<Panel className="chat-settings" title="调用配置">
				<div className="panel-body">
					<div className="field">
						<label htmlFor="lab-session">预算会话</label>
						<ConsoleSelect
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
							{usd(selected ? remainingBudget(selected) : 0, true)}
							<small>{asset}</small>
						</div>
						<small>费用先预留，再按实际用量核销。</small>
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
				<div aria-live="polite" className="chat-messages">
					{!messages.length ? (
						<Empty
							description="发送消息，查看响应与用量。"
							icon={Sparkles}
							title="开始对话"
						/>
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
						<div className="chat-message-label">
							<LoaderCircle className="spin" size={13} />
							正在等待上游响应…
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
						placeholder="输入你的消息…"
						value={prompt}
					/>
					<div className="chat-composer-bottom">
						<span>输出上限 512 Token · 会话内使用同一资源</span>
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
							发送请求
						</button>
					</div>
				</form>
			</Panel>
		</div>
	);
}
