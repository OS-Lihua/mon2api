import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "~/server/services/auth";
import * as api from "./commerce";

const mocks = vi.hoisted(() => ({
	user: vi.fn(),
	origin: vi.fn(),
	createListing: vi.fn(),
	updateListing: vi.fn(),
	listResources: vi.fn(),
	listRequests: vi.fn(),
	authenticateKey: vi.fn(),
	lookup: vi.fn(),
	limit: vi.fn(),
	challenge: vi.fn(),
	login: vi.fn(),
	getSession: vi.fn(),
	settle: vi.fn(),
	confirm: vi.fn(),
	createKey: vi.fn(),
}));
vi.mock("~/server/services/auth", () => ({
	AppError: class extends Error {
		constructor(
			public code: string,
			message: string,
			public status = 400,
		) {
			super(message);
		}
	},
	requireViewer: mocks.user,
	assertSameOrigin: mocks.origin,
	logout: vi.fn(),
	walletChallenge: mocks.challenge,
	walletLogin: mocks.login,
}));
vi.mock("~/server/services/commerce", () => ({
	listResources: mocks.listResources,
	listRequests: mocks.listRequests,
	lookupRequest: mocks.lookup,
	getConsumerSession: mocks.getSession,
	networkInfo: vi.fn(),
	accountBalances: vi.fn(),
	getResource: vi.fn(),
	listSessions: vi.fn(),
	listKeys: vi.fn(),
	listSettlements: vi.fn(),
}));
vi.mock("~/server/services/market", () => ({
	authenticateKey: mocks.authenticateKey,
	createListing: mocks.createListing,
	updateListing: mocks.updateListing,
	confirmSession: mocks.confirm,
	createKey: mocks.createKey,
	openSession: vi.fn(),
	revokeKey: vi.fn(),
	toggleListing: vi.fn(),
}));
vi.mock("~/server/services/settlement", () => ({
	closeSession: vi.fn(),
	settleSession: mocks.settle,
}));
vi.mock("~/server/security/rate-limit", () => ({
	limitRequest: mocks.limit,
	limitCredential: async () => ({ success: true }),
}));
vi.mock("~/server/observability/logger", () => ({
	logger: { error: vi.fn() },
}));
vi.mock("~/env", () => ({ env: { ALLOWED_ORIGINS: "http://localhost:3000" } }));
const user = { address: `0x${"11".repeat(20)}`, name: "Buyer", demo: false };
const id = "caaaaaaaaaaaaaaaaaaaaaaaa";
const input = {
	name: "My pool",
	description: "Text gateway",
	model: "test-model",
	kind: "demo",
	inputRate: 1,
	outputRate: 2,
};
function req(
	path: string,
	body?: unknown,
	headers: Record<string, string> = {},
) {
	return new Request(`http://localhost:3000/api/v1${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: { "content-type": "application/json", ...headers },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}
beforeEach(() => {
	vi.resetAllMocks();
	mocks.user.mockResolvedValue(user);
	mocks.limit.mockResolvedValue({ success: true });
	mocks.listResources.mockResolvedValue({
		data: [],
		hasMore: false,
		nextCursor: null,
	});
	mocks.listRequests.mockResolvedValue({
		data: [],
		hasMore: false,
		nextCursor: null,
	});
	mocks.createListing.mockResolvedValue({ id });
	mocks.updateListing.mockResolvedValue({ ok: true });
});
describe("merchant and consumer REST security", () => {
	it("passes gateway credentials to the shared resource service", async () => {
		const response = await api.merchantResourcesPost(
			req("/merchant/resources", {
				...input,
				kind: "gateway",
				baseUrl: "https://pool.example/v1",
				apiKey: "test-dedicated-key",
			}),
		);
		expect(response.status).toBe(201);
		expect(mocks.createListing).toHaveBeenCalledWith(
			user,
			expect.objectContaining({
				baseUrl: "https://pool.example/v1",
				apiKey: "test-dedicated-key",
			}),
		);
		expect(await response.json()).not.toHaveProperty("apiKey");
	});
	it("rejects unauthenticated management access and marks errors no-store", async () => {
		mocks.user.mockRejectedValue(new AppError("unauthorized", "Sign in", 401));
		const response = await api.merchantResourcesGet(req("/merchant/resources"));
		expect(response.status).toBe(401);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(mocks.listResources).not.toHaveBeenCalled();
	});
	it("never promotes inference keys to management credentials, even with a session", async () => {
		const response = await api.merchantResourcesPost(
			req("/merchant/resources", input, { authorization: "Bearer t2a_test" }),
		);
		expect(response.status).toBe(401);
		expect(mocks.user).not.toHaveBeenCalled();
		expect(mocks.createListing).not.toHaveBeenCalled();
	});
	it("rejects cross-origin writes before business logic", async () => {
		mocks.origin.mockImplementation(() => {
			throw new AppError("forbidden", "Origin mismatch", 403);
		});
		const response = await api.merchantResourcesPost(
			req("/merchant/resources", input, { origin: "https://attacker.example" }),
		);
		expect(response.status).toBe(403);
		expect(mocks.createListing).not.toHaveBeenCalled();
	});
	it("creates resources only under the authenticated wallet", async () => {
		const response = await api.merchantResourcesPost(
			req("/merchant/resources", input),
		);
		expect(response.status).toBe(201);
		expect(mocks.createListing).toHaveBeenCalledWith(
			user,
			expect.objectContaining({ name: input.name, concurrency: 2 }),
		);
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
	});
	it("rejects caller-supplied owners, malformed gateway inputs and decimal money", async () => {
		for (const body of [
			{ ...input, owner: user.address },
			{ ...input, kind: "gateway" },
			{ ...input, inputRate: 1.5 },
		]) {
			const response = await api.merchantResourcesPost(
				req("/merchant/resources", body),
			);
			expect(response.status).toBe(400);
		}
		expect(mocks.createListing).not.toHaveBeenCalled();
	});
	it.each([
		"?limit=101",
		"?limit=0",
		"?limit=2&limit=3",
		"?owner=somebody",
		"?__proto__=x",
	])("rejects invalid or unknown query fields %s", async (suffix) => {
		const response = await api.merchantResourcesGet(
			req(`/merchant/resources${suffix}`),
		);
		expect(response.status).toBe(400);
		expect(mocks.listResources).not.toHaveBeenCalled();
	});
	it("supports bounded cursors and stable owner scoping", async () => {
		const response = await api.merchantResourcesGet(
			req(`/merchant/resources?limit=1&cursor=${id}`),
		);
		expect(response.status).toBe(200);
		expect(mocks.listResources).toHaveBeenCalledWith(
			{ limit: 1, cursor: id },
			user.address,
		);
	});
	it.each([
		{},
		{ model: "other" },
		{ apiKey: "replacement" },
		{ baseUrl: "https://other.example/v1" },
		{ kind: "gateway" },
	])("rejects empty or binding-changing edits %j", async (changes) => {
		const response = await api.merchantResourcePost(
			req(`/merchant/resources/${id}`, changes),
			id,
		);
		expect(response.status).toBe(400);
		expect(mocks.updateListing).not.toHaveBeenCalled();
	});
	it("rejects invalid path IDs before writes", async () => {
		const response = await api.merchantResourcePost(
			req("/merchant/resources/bad", { concurrency: 3 }),
			"bad",
		);
		expect(response.status).toBe(400);
		expect(mocks.updateListing).not.toHaveBeenCalled();
	});
	it("does not expose private exceptions", async () => {
		mocks.listResources.mockRejectedValue(
			new Error("database password / provider token"),
		);
		const response = await api.resourcesGet(req("/resources"));
		expect(response.status).toBe(500);
		expect(await response.text()).not.toContain("password");
	});
	it("uses shared rate limiting for management operations", async () => {
		mocks.limit.mockResolvedValue({
			success: false,
			limit: 1,
			remaining: 0,
			reset: 100,
		});
		const response = await api.merchantResourcesPost(
			req("/merchant/resources", input),
		);
		expect(response.status).toBe(429);
		expect(mocks.createListing).not.toHaveBeenCalled();
	});
	it("does not let a provider settle another consumer's session through the consumer endpoint", async () => {
		mocks.getSession.mockRejectedValue(
			new AppError("not_found", "Missing", 404),
		);
		const sessionId = `0x${"22".repeat(32)}`;
		const response = await api.settlePost(
			req(`/consumer/sessions/${sessionId}/settle`, {}),
			sessionId,
		);
		expect(response.status).toBe(404);
		expect(mocks.settle).not.toHaveBeenCalled();
	});
	it("looks up usage with the authenticated inference key, not a caller-supplied session", async () => {
		const key = { owner: user.address, sessionId: `0x${"22".repeat(32)}` };
		mocks.authenticateKey.mockResolvedValue(key);
		mocks.lookup.mockRejectedValue(new AppError("not_found", "Missing", 404));
		const response = await api.requestLookupGet(
			req("/requests/lookup?idempotency_key=logical-request-1", undefined, {
				authorization: "Bearer inference-key",
			}),
		);
		expect(response.status).toBe(404);
		expect(mocks.lookup).toHaveBeenCalledWith(key, "logical-request-1");
	});
	it("rejects invalid public auth inputs and forwards valid SIWE signatures", async () => {
		mocks.challenge.mockResolvedValue({ message: "SIWE challenge" });
		mocks.login.mockResolvedValue(user);
		const challenge = await api.challengePost(
			req("/auth/challenge", { address: user.address }),
		);
		expect(challenge.status).toBe(200);
		const login = {
			address: user.address,
			message: "SIWE challenge",
			signature: "0xabcd",
		};
		expect((await api.loginPost(req("/auth/login", login))).status).toBe(200);
		expect(mocks.login).toHaveBeenCalledWith(
			login.address,
			login.message,
			login.signature,
		);
		expect(
			(
				await api.loginPost(
					req("/auth/login", { ...login, signature: "not-hex" }),
				)
			).status,
		).toBe(400);
	});
});

describe("buyer connection REST responses", () => {
	const sessionId = `0x${"ab".repeat(32)}`;
	const connection = {
		base_url: "https://market.example/v1",
		key: `t2a_${"x".repeat(43)}`,
		model: "seller/model",
	};
	it("returns a no-store connection bundle after funded-session confirmation", async () => {
		mocks.confirm.mockResolvedValue({
			id: sessionId,
			status: "ACTIVE",
			connection,
		});
		const response = await api.confirmPost(
			req(`/consumer/sessions/${sessionId}/confirm`, {}),
			sessionId,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({
			id: sessionId,
			status: "ACTIVE",
			connection,
		});
		expect(mocks.confirm).toHaveBeenCalledWith(
			user,
			sessionId,
			undefined,
			true,
		);
	});
	it("returns the same connection shape for manually created replacement keys", async () => {
		mocks.createKey.mockResolvedValue(connection);
		const response = await api.keysPost(
			req("/consumer/keys", { sessionId, name: "replacement" }),
		);
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual(connection);
		expect(response.headers.get("cache-control")).toBe("no-store");
	});
});
