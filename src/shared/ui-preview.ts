import type { Snapshot } from "./mon2api";
import { MONAD_TESTNET } from "./network";

export const uiPreview =
	process.env.NODE_ENV === "development" &&
	process.env.NEXT_PUBLIC_UI_PREVIEW === "true";
const owner = "0x0000000000000000000000000000000000000001";
export const previewSnapshot: Snapshot = {
	viewer: { address: owner, name: "UI 预览", demo: true },
	network: {
		...MONAD_TESTNET,
		asset: "MON",
		ledgerUnit: "micro_MON",
		balanceUnit: "wei",
		escrow: owner,
		token: "0x0000000000000000000000000000000000000000",
		feeBps: 500,
		ready: false,
		explorer: "",
	},
	metrics: {
		requests: 0,
		inputTokens: 0,
		outputTokens: 0,
		spent: 0,
		pending: 0,
		settled: 0,
		writtenOff: 0,
		claimable: null,
		walletBalance: null,
	},
	listings: ["Northstar Pool", "Orbit Compute", "Community Node"].map(
		(name, index) => ({
			id: `ui-preview-${index}`,
			name,
			description: "UI 预览模拟资源 · 未连接真实服务",
			model: "mon2api-demo",
			owner,
			kind: "demo",
			connectionMode: "api",
			transport: "direct",
			online: true,
			enabled: true,
			inputRate: [3000000, 2000000, 1500000][index] ?? 3000000,
			outputRate: [15000000, 10000000, 8000000][index] ?? 15000000,
			concurrency: 2,
			activeRequests: 0,
			status: "ready",
			createdAt: "2026-10-17T00:00:00.000Z",
		}),
	),
	sessions: [],
	requests: [],
	keys: [],
	settlements: [],
};
