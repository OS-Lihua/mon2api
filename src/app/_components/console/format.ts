import { formatAsset } from "~/shared/money";
import type { SettlementAsset } from "~/shared/settlement-asset";
import type { ListingView, SessionView } from "~/shared/token2api";

export type Section =
	| "overview"
	| "market"
	| "pool"
	| "lab"
	| "billing"
	| "keys";
export type Tone = "green" | "warn" | "neutral";

const compactFormat = Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});
export const compact = (amount: number) => compactFormat.format(amount);
export const short = (value: string) =>
	value.length > 18 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
const dateFormat = Intl.DateTimeFormat("zh-CN", {
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});
export const date = (value: string) => dateFormat.format(new Date(value));
export const assetFormatter =
	(asset: SettlementAsset) =>
	(amount: number | string, precise = false) =>
		formatAsset(amount, asset, precise);
export const sameAddress = (left?: string | null, right?: string | null) =>
	!!left && !!right && left.toLowerCase() === right.toLowerCase();
export const activeSession = (session: SessionView) =>
	session.status.toLowerCase() === "active";
/** Budget a session can still reserve; never negative. */
export const remainingBudget = (session: SessionView) =>
	Math.max(0, session.budget - session.spent - session.reserved);
export const onlineListings = (listings: ListingView[]) =>
	listings.filter((item) => item.enabled && item.online).length;

const statusLabels: Record<string, string> = {
	active: "使用中",
	pending: "待确认",
	closed: "已关闭",
	closing: "关闭中",
	ready: "可用",
	online: "在线",
	paused: "已暂停",
	offline: "连接器离线",
	disabled: "已下架",
	cooldown: "冷却中",
	auth_required: "需检查连接器凭证",
	success: "成功",
	completed: "已完成",
	failed: "失败",
	settled: "已结算",
	confirmed: "已确认",
	uncollectible: "无法收回",
	running: "执行中",
	pending_usage: "待核对",
	review: "待核对",
	draft: "待确认",
};
export const statusLabel = (status: string) =>
	statusLabels[status.toLowerCase()] ?? status;
const warnStatuses = new Set([
	"review",
	"pending_usage",
	"failed",
	"auth_required",
	"uncollectible",
	"cooldown",
	"offline",
]);
const greenStatuses = new Set([
	"ready",
	"online",
	"active",
	"completed",
	"confirmed",
	"success",
	"settled",
]);
export const statusTone = (status: string): Tone => {
	const value = status.toLowerCase();
	if (warnStatuses.has(value)) return "warn";
	if (greenStatuses.has(value)) return "green";
	return "neutral";
};
export const listingStatus = (item: ListingView) => {
	if (item.enabled)
		return { tone: statusTone(item.status), label: statusLabel(item.status) };
	if (item.status === "AUTH_REQUIRED")
		return { tone: statusTone(item.status), label: statusLabel(item.status) };
	return {
		tone: statusTone("PAUSED"),
		label: item.status === "DISCOVERING" ? "待选择模型" : "已暂停",
	};
};
export const listingKind = (
	item: ListingView,
	labels: { demo: string; api: string },
) =>
	item.kind === "demo"
		? labels.demo
		: item.transport === "local"
			? "本机连接器"
			: item.connectionMode === "oauth_pool"
				? "OAuth 号池"
				: labels.api;
