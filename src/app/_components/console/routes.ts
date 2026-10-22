import type { Section } from "./format";

export const consoleRoutes: Record<
	Section,
	{ href: string; title: string; description: string }
> = {
	overview: {
		href: "/console",
		title: "概览",
		description: "查看资源、调用活动与当前市场的结算情况。",
	},
	market: {
		href: "/console/market",
		title: "资源市场",
		description: "比较模型与报价，选择适合你的调用资源。",
	},
	pool: {
		href: "/console/pool",
		title: "我的资源",
		description: "接入并管理资源，查看连接状态与挂牌价格。",
	},
	lab: {
		href: "/console/lab",
		title: "调用实验室",
		description: "选择预算会话，发送请求并核对调用用量。",
	},
	billing: {
		href: "/console/billing",
		title: "账单与结算",
		description: "核对预算、用量与链上结算，管理未用余额。",
	},
	keys: {
		href: "/console/keys",
		title: "API 密钥",
		description: "为应用管理独立密钥，每个密钥绑定一个预算会话。",
	},
};

export function isConsoleSection(value: string | null): value is Section {
	return value !== null && Object.hasOwn(consoleRoutes, value);
}
