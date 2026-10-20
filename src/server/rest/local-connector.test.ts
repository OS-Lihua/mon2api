import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "~/server/services/auth";
import {
	catalogConnectorPost,
	connectConnectorPost,
	createConnectorLaunchPost,
	createConnectorPost,
	createDraftPost,
	pollConnectorPost,
	publishDraftPost,
	rotateConnectorPost,
	setupConnectorPost,
} from "./local-connector";

const mocks = vi.hoisted(() => ({
	user: vi.fn(),
	origin: vi.fn(),
	create: vi.fn(),
	rotate: vi.fn(),
	poll: vi.fn(),
	limit: vi.fn(),
	draft: vi.fn(),
	catalog: vi.fn(),
	publish: vi.fn(),
	setup: vi.fn(),
	launch: vi.fn(),
	connect: vi.fn(),
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
}));
vi.mock("~/server/services/local-connector", () => ({
	authenticateConnector: async () => ({ listing: { id: "listing-1" } }),
	createLocalListing: mocks.create,
	rotateConnector: mocks.rotate,
	pollConnector: mocks.poll,
	updateConnector: vi.fn(),
	disconnectConnector: vi.fn(),
	connectorStatus: vi.fn(),
	createLocalDraft: mocks.draft,
	reportConnectorCatalog: mocks.catalog,
	publishLocalDraft: mocks.publish,
	connectorSetup: mocks.setup,
	createConnectorLaunch: mocks.launch,
	redeemConnectorLaunch: mocks.connect,
}));
vi.mock("~/server/services/market", () => ({ discoverDirectModels: vi.fn() }));
vi.mock("~/server/security/rate-limit", () => ({
	limitRequest: mocks.limit,
	limitCredential: async () => ({ success: true }),
}));
vi.mock("~/server/observability/logger", () => ({
	logger: { error: vi.fn() },
}));
const user = { address: `0x${"11".repeat(20)}`, name: "Seller", demo: false };
const id = "caaaaaaaaaaaaaaaaaaaaaaaa";
const token = `t2c_${"a".repeat(43)}`;
const input = {
	kind: "gateway",
	name: "Local resource",
	description: "Private key stays local",
	model: "test-model",
	inputRate: 1,
	outputRate: 2,
};
function req(body: unknown, headers: Record<string, string> = {}) {
	return new Request("http://localhost:3000/api/v1/merchant/connectors/local", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}
beforeEach(() => {
	vi.resetAllMocks();
	mocks.user.mockResolvedValue(user);
	mocks.limit.mockResolvedValue({ success: true });
	mocks.create.mockResolvedValue({ id, token });
	mocks.rotate.mockResolvedValue({ id, token });
	mocks.poll.mockResolvedValue({ listingId: id, enabled: true, job: null });
	mocks.draft.mockResolvedValue({ id, token });
	mocks.catalog.mockResolvedValue({ ok: true });
});
describe("local connector REST boundaries", () => {
	it("keeps launch creation behind wallet authentication and permits only code exchange on the public endpoint", async () => {
		const code = `t2l_${"b".repeat(43)}`;
		mocks.launch.mockResolvedValue({
			code,
			expiresAt: new Date(Date.now() + 300000).toISOString(),
		});
		mocks.connect.mockResolvedValue({ token });
		expect(
			(
				await createConnectorLaunchPost(
					req({ id }, { authorization: `Bearer ${token}` }),
				)
			).status,
		).toBe(401);
		expect((await createConnectorLaunchPost(req({ id }))).status).toBe(200);
		expect(mocks.launch).toHaveBeenCalledWith(user, id);
		const response = await connectConnectorPost(
			req({}, { authorization: `Bearer ${code}` }),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({ token });
		expect(mocks.connect).toHaveBeenCalledWith(`Bearer ${code}`);
		expect(
			(
				await connectConnectorPost(
					req({ owner: "other" }, { authorization: `Bearer ${code}` }),
				)
			).status,
		).toBe(400);
	});
	it("starts discovery without accepting a manually entered model or credentials", async () => {
		const draft = {
			name: "Magpie",
			description: "Local gateway",
			kind: "gateway",
		};
		expect((await createDraftPost(req(draft))).status).toBe(200);
		for (const extra of [
			{ model: "invented" },
			{ apiKey: "private-key" },
			{ owner: "other" },
		])
			expect((await createDraftPost(req({ ...draft, ...extra }))).status).toBe(
				400,
			);
	});
	it("accepts model IDs only from connectors, never upstream credentials or ownership changes", async () => {
		const authorization = `Bearer ${token}`;
		expect(
			(
				await catalogConnectorPost(
					req({ models: ["magpie/model"] }, { authorization }),
				)
			).status,
		).toBe(200);
		expect(mocks.catalog).toHaveBeenCalledWith(authorization, ["magpie/model"]);
		expect(
			(
				await catalogConnectorPost(
					req(
						{ models: ["magpie/model"], apiKey: "private-key" },
						{ authorization },
					),
				)
			).status,
		).toBe(400);
	});
	it("does not let a connector publish prices or read merchant setup", async () => {
		const headers = { authorization: `Bearer ${token}` };
		expect(
			(
				await publishDraftPost(
					req(
						{ id, model: "magpie/model", inputRate: 1, outputRate: 2 },
						headers,
					),
				)
			).status,
		).toBe(401);
		expect((await setupConnectorPost(req({ id }, headers))).status).toBe(401);
		expect(mocks.publish).not.toHaveBeenCalled();
		expect(mocks.setup).not.toHaveBeenCalled();
	});
	it("creates supply under the authenticated owner and returns the credential once", async () => {
		const response = await createConnectorPost(req(input));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id, token });
		expect(mocks.create).toHaveBeenCalledWith(
			user,
			expect.objectContaining({ concurrency: 1 }),
		);
		expect(response.headers.get("cache-control")).toBe("no-store");
	});
	it.each([`Bearer ${token}`, "Bearer t2a_inference"])(
		"cannot use %s for merchant management",
		async (authorization) => {
			const response = await createConnectorPost(req(input, { authorization }));
			expect(response.status).toBe(401);
			expect(mocks.user).not.toHaveBeenCalled();
			expect(mocks.create).not.toHaveBeenCalled();
		},
	);
	it("rejects missing wallet authentication", async () => {
		mocks.user.mockRejectedValue(new AppError("unauthorized", "Sign in", 401));
		expect((await createConnectorPost(req(input))).status).toBe(401);
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it("rejects cross-origin writes before creating credentials", async () => {
		mocks.origin.mockImplementation(() => {
			throw new AppError("forbidden", "Origin mismatch", 403);
		});
		expect(
			(
				await createConnectorPost(
					req(input, { origin: "https://other.example" }),
				)
			).status,
		).toBe(403);
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it.each([
		{ apiKey: "upstream-secret" },
		{ baseUrl: "http://127.0.0.1:8080/v1" },
		{ owner: user.address },
		{ concurrency: 2 },
	])("rejects extra local-only credentials or ownership %j", async (extra) => {
		const response = await createConnectorPost(req({ ...input, ...extra }));
		expect(response.status).toBe(400);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it("scopes credential rotation to the signed-in owner", async () => {
		expect((await rotateConnectorPost(req({ id }))).status).toBe(200);
		expect(mocks.rotate).toHaveBeenCalledWith(user, id);
	});
	it("forwards only the resource bearer and selected model when polling", async () => {
		expect(
			(
				await pollConnectorPost(
					req({ model: "test-model" }, { authorization: `Bearer ${token}` }),
				)
			).status,
		).toBe(200);
		expect(mocks.poll).toHaveBeenCalledWith(`Bearer ${token}`, "test-model");
	});
	it("applies shared rate limiting before claiming work", async () => {
		mocks.limit.mockResolvedValue({
			success: false,
			limit: 1,
			remaining: 0,
			reset: 100,
		});
		expect((await pollConnectorPost(req({ model: "test-model" }))).status).toBe(
			429,
		);
		expect(mocks.poll).not.toHaveBeenCalled();
	});
});
