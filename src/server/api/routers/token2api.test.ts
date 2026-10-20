import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTRPCContext, createTRPCRouter } from "../trpc";
import { token2apiRouter } from "./token2api";

const mocks = vi.hoisted(() => ({
	walletLogin: vi.fn(),
	walletChallenge: vi.fn(),
	demoLogin: vi.fn(),
	logout: vi.fn(),
	requireViewer: vi.fn(),
	createListing: vi.fn(),
	limitRequest: vi.fn(),
}));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/observability/logger", () => ({ logger: { info: vi.fn() } }));
vi.mock("~/server/security/rate-limit", () => ({
	limitRequest: mocks.limitRequest,
	limitCredential: async () => ({ success: true }),
}));
vi.mock("~/server/services/auth", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("~/server/services/auth")>();
	return {
		...actual,
		walletLogin: mocks.walletLogin,
		walletChallenge: mocks.walletChallenge,
		demoLogin: mocks.demoLogin,
		logout: mocks.logout,
		requireViewer: mocks.requireViewer,
	};
});
vi.mock("~/server/services/market", () => ({
	createListing: mocks.createListing,
	confirmSession: vi.fn(),
	createKey: vi.fn(),
	openSession: vi.fn(),
	revokeKey: vi.fn(),
	snapshot: vi.fn(),
	toggleListing: vi.fn(),
	withdraw: vi.fn(),
}));
vi.mock("~/server/services/metering", () => ({ runChat: vi.fn() }));
vi.mock("~/server/services/settlement", () => ({
	closeSession: vi.fn(),
	settleSession: vi.fn(),
}));

const router = createTRPCRouter({
	token2api: token2apiRouter,
	mon2api: token2apiRouter,
});
const address = `0x${"11".repeat(20)}`;
function request(
	path: string,
	input: unknown,
	origin = "http://localhost:3000",
) {
	const req = new Request(`http://localhost:3000/api/trpc/token2api.${path}`, {
		method: "POST",
		headers: { origin, "content-type": "application/json" },
		body: JSON.stringify({ json: input }),
	});
	return fetchRequestHandler({
		endpoint: "/api/trpc",
		req,
		router,
		createContext: () => createTRPCContext({ headers: req.headers }),
	});
}

describe("Token2API HTTP router authentication boundaries", () => {
	beforeEach(() => {
		vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
		vi.resetAllMocks();
		mocks.limitRequest.mockResolvedValue({ success: true });
		mocks.walletLogin.mockResolvedValue({ address, demo: false });
		mocks.walletChallenge.mockResolvedValue({ message: "challenge" });
		mocks.demoLogin.mockResolvedValue({ address, demo: true });
	});
	afterEach(() => vi.unstubAllEnvs());

	it.each([
		"demoLogin",
		"walletChallenge",
		"walletLogin",
		"logout",
		"createListing",
	])(
		"returns HTTP 403 FORBIDDEN for cross-origin %s before executing business logic",
		async (path) => {
			const response = await request(path, {}, "https://attacker.example");
			expect(response.status).toBe(403);
			const body = await response.json();
			expect(body.error.json.data.code).toBe("FORBIDDEN");
			for (const action of [
				mocks.demoLogin,
				mocks.walletChallenge,
				mocks.walletLogin,
				mocks.logout,
				mocks.requireViewer,
				mocks.createListing,
			])
				expect(action).not.toHaveBeenCalled();
		},
	);

	it("rejects every cross-origin operation in a batch", async () => {
		const req = new Request(
			"http://localhost:3000/api/trpc/token2api.walletChallenge,token2api.logout?batch=1",
			{
				method: "POST",
				headers: {
					origin: "https://attacker.example",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					"0": { json: { address } },
					"1": { json: null },
				}),
			},
		);
		const response = await fetchRequestHandler({
			endpoint: "/api/trpc",
			req,
			router,
			createContext: () => createTRPCContext({ headers: req.headers }),
		});
		expect(response.status).toBe(403);
		const body = await response.json();
		expect(body).toHaveLength(2);
		expect(body[0].error.json.data.code).toBe("FORBIDDEN");
		expect(body[1].error.json.data.code).toBe("FORBIDDEN");
		expect(mocks.walletChallenge).not.toHaveBeenCalled();
		expect(mocks.logout).not.toHaveBeenCalled();
	});

	it.each(["0x", "0x1", "0x123", "0xgg", "invalid", `0x${"ab".repeat(8193)}`])(
		"returns HTTP 400 BAD_REQUEST for malformed or oversized signature %#",
		async (signature) => {
			const response = await request("walletLogin", {
				address,
				message: "challenge",
				signature,
			});
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.json.data.code).toBe("BAD_REQUEST");
			expect(mocks.walletLogin).not.toHaveBeenCalled();
		},
	);

	it("accepts bounded ERC-1271 signatures larger than 1000 characters", async () => {
		const signature = `0x${"ab".repeat(8192)}`;
		const response = await request("walletLogin", {
			address,
			message: "challenge",
			signature,
		});
		expect(response.status).toBe(200);
		expect(mocks.walletLogin).toHaveBeenCalledWith(
			address,
			"challenge",
			signature,
		);
	});

	it("maps an invalid signature to HTTP 401", async () => {
		const { AppError } = await import("~/server/services/auth");
		mocks.walletLogin.mockRejectedValue(
			new AppError("invalid_signature", "钱包签名无效。", 401),
		);
		const response = await request("walletLogin", {
			address,
			message: "challenge",
			signature: "0x1234",
		});
		expect(response.status).toBe(401);
		expect((await response.json()).error.json.data.code).toBe("UNAUTHORIZED");
	});

	it("maps verification RPC failure to HTTP 500 with a safe message", async () => {
		mocks.walletLogin.mockRejectedValue(new Error("RPC secret details"));
		const response = await request("walletLogin", {
			address,
			message: "challenge",
			signature: "0x1234",
		});
		expect(response.status).toBe(500);
		const body = await response.json();
		expect(body.error.json.data.code).toBe("INTERNAL_SERVER_ERROR");
		expect(body.error.json.message).not.toContain("RPC secret details");
	});
});
