export type Viewer = { address: string; name: string; demo: boolean };
export type NetworkInfo = {
	mode: "local" | "monad-testnet";
	name: string;
	chainId: number;
	rpcUrl: string;
	escrow: string;
	token: string;
	feeBps: number;
	ready: boolean;
	explorer: string;
};
export type ListingView = {
	id: string;
	name: string;
	description: string;
	model: string;
	owner: string;
	kind: "demo" | "gateway";
	connectionMode: "api" | "oauth_pool";
	enabled: boolean;
	inputRate: number;
	outputRate: number;
	concurrency: number;
	activeRequests: number;
	status: string;
	createdAt: string;
};
export type SessionView = {
	id: string;
	listingId: string;
	listingName: string;
	model: string;
	consumer: string;
	provider: string;
	budget: number;
	spent: number;
	reserved: number;
	settled: number;
	writtenOff: number;
	status: string;
	expiresAt: string;
	openTx: string | null;
	closeTx: string | null;
};
export type RequestView = {
	id: string;
	sessionId: string;
	listingName: string;
	model: string;
	status: string;
	inputTokens: number | null;
	outputTokens: number | null;
	cost: number;
	usageSource: string;
	upstreamRequestId: string | null;
	createdAt: string;
	settled: boolean;
};
export type KeyView = {
	id: string;
	name: string;
	prefix: string;
	sessionId: string;
	revoked: boolean;
	createdAt: string;
};
export type SettlementView = {
	id: string;
	sessionId: string;
	amount: number;
	status: string;
	txHash: string | null;
	createdAt: string;
};
export type Snapshot = {
	viewer: Viewer | null;
	network: NetworkInfo;
	metrics: {
		requests: number;
		inputTokens: number;
		outputTokens: number;
		spent: number;
		pending: number;
		settled: number;
		writtenOff: number;
		claimable: string | null;
		walletBalance: string | null;
	};
	listings: ListingView[];
	sessions: SessionView[];
	requests: RequestView[];
	keys: KeyView[];
	settlements: SettlementView[];
};
export type OpenSessionResult = {
	id: string;
	mode: "demo" | "wallet";
	txHash?: string;
	transaction: {
		id: string;
		provider: string;
		termsHash: string;
		budget: number;
		expiresAt: number;
	};
};
export type ChatResult = {
	id: string;
	text: string;
	finishReason: "stop" | "length" | "content_filter";
	inputTokens: number;
	outputTokens: number;
	cost: number;
	usageSource: string;
};
