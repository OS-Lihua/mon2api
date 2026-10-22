import type { Listing } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./auth";
import { prepaidAccount, runModelChat } from "./model-routing";

const mocks = vi.hoisted(() => ({
	db: {
		$transaction: vi.fn(),
		$queryRaw: vi.fn(),
		accessKey: { findUnique: vi.fn() },
		modelProduct: { findUnique: vi.fn() },
		routedInvocation: { findUnique: vi.fn(), create: vi.fn() },
		lease: {
			aggregate: vi.fn(),
			count: vi.fn(),
			create: vi.fn(),
			updateMany: vi.fn(),
			findMany: vi.fn(),
		},
		meterRequest: { count: vi.fn() },
	},
	readPrepaidBalance: vi.fn(),
	readEscrowPaused: vi.fn(),
	sendPrepaidReserve: vi.fn(),
	reject: vi.fn(),
	runChat: vi.fn(),
	gateway: vi.fn(),
}));
vi.mock("~/server/db", () => ({ db: mocks.db }));
vi.mock("./runtime", () => ({
	ensureChainBinding: vi.fn(),
	demoEnabled: () => true,
	sessionPassword: () => "unused",
}));
vi.mock("./market", () => ({ lock: vi.fn() }));
vi.mock("./chain", () => ({
	clients: () => ({
		config: {
			mode: "local",
			chainId: 31337,
			asset: "ETH",
			tokenDecimals: 18,
			escrow: `0x${"33".repeat(20)}`,
		},
	}),
	readPrepaidBalance: mocks.readPrepaidBalance,
	readEscrowPaused: mocks.readEscrowPaused,
	sendPrepaidReserve: mocks.sendPrepaidReserve,
	rejectUnsentPrepaidReservation: mocks.reject,
}));
vi.mock("./gateway-access", () => ({ requireGatewayAccess: mocks.gateway }));
vi.mock("./metering", async (original) => ({
	...(await original<typeof import("./metering")>()),
	runChat: mocks.runChat,
}));

const owner = `0x${"11".repeat(20)}`;
const key = {
	id: "cmkey000000000000000000000",
	owner,
	sessionId: null,
	revoked: false,
	models: ["public-model"],
};
const listing: Listing = {
	id: "cmroute0000000000000000000",
	owner: `0x${"22".repeat(20)}`,
	name: "upstream",
	description: "fixture",
	model: "private-upstream-model",
	kind: "gateway",
	transport: "local",
	enabled: true,
	status: "READY",
	concurrency: 1,
	inputRate: 500_000,
	outputRate: 750_000,
	baseUrl: null,
	secret: null,
	proxyUrl: null,
	proxySecret: null,
	connectorHash: null,
	connectorLaunchHash: null,
	connectorLaunchExpiresAt: null,
	connectorSeenAt: new Date(),
	connectorCatalog: ["private-upstream-model"],
	connectorCatalogAt: new Date(),
	createdAt: new Date(),
};
const route = { id: "first", priority: 1, enabled: true, listing };
const alternative = {
	...route,
	id: "second",
	priority: 2,
	listing: { ...listing, id: "cmroute1000000000000000000" },
};
const model = {
	id: "public-model",
	enabled: true,
	inputRate: 1_000_000,
	outputRate: 2_000_000,
	routes: [route, alternative],
};
const input = {
	keyId: key.id,
	model: model.id,
	messages: [{ role: "user" as const, content: "hello" }],
	maxTokens: 128,
	conversationId: "conversation",
	idempotencyKey: "routing-request-0001",
};
beforeEach(() => {
	vi.resetAllMocks();
	mocks.db.$transaction.mockImplementation(
		async (action: (tx: typeof mocks.db) => Promise<unknown>) =>
			action(mocks.db),
	);
	mocks.db.$queryRaw.mockResolvedValue([{ locked: true }]);
	mocks.db.accessKey.findUnique.mockResolvedValue(key);
	mocks.db.modelProduct.findUnique.mockResolvedValue(model);
	mocks.db.routedInvocation.findUnique.mockResolvedValue(null);
	mocks.db.lease.aggregate.mockResolvedValue({ _sum: { budget: 0n } });
	mocks.db.lease.count.mockResolvedValue(0);
	mocks.db.lease.updateMany.mockResolvedValue({ count: 1 });
	mocks.db.meterRequest.count.mockResolvedValue(0);
	mocks.db.lease.create.mockImplementation(async ({ data }) => ({
		...data,
		budget: BigInt(data.budget),
	}));
	mocks.readPrepaidBalance.mockResolvedValue({
		micro: 1_000_000,
		balance: "1000000000000000000",
	});
	mocks.readEscrowPaused.mockResolvedValue(false);
	mocks.sendPrepaidReserve.mockResolvedValue(`0x${"44".repeat(32)}`);
	mocks.runChat.mockResolvedValue({ id: "metered", cost: 60 });
});
describe("model routing admission", () => {
	it.each([
		{ ...key, owner: "another-wallet" },
		{ ...key, revoked: true },
		{ ...key, sessionId: "legacy-lease" },
		{ ...key, models: ["different-model"] },
	])(
		"refuses invalid key ownership, state or model scope before allocating funds",
		async (invalid) => {
			mocks.db.accessKey.findUnique.mockResolvedValue(invalid);
			await expect(runModelChat(owner, input)).rejects.toBeInstanceOf(AppError);
			expect(mocks.sendPrepaidReserve).not.toHaveBeenCalled();
			expect(mocks.db.lease.create).not.toHaveBeenCalled();
			expect(mocks.runChat).not.toHaveBeenCalled();
		},
	);
	it("keeps idempotency at the key level before selecting any model or resource", async () => {
		mocks.db.routedInvocation.findUnique.mockResolvedValue({
			sessionId: "previous-route",
		});
		await expect(runModelChat(owner, input)).rejects.toMatchObject({
			code: "duplicate_request",
		});
		expect(mocks.db.routedInvocation.findUnique).toHaveBeenCalledWith({
			where: {
				accessKeyId_idempotencyKey: {
					accessKeyId: key.id,
					idempotencyKey: input.idempotencyKey,
				},
			},
		});
		expect(mocks.db.modelProduct.findUnique).not.toHaveBeenCalled();
		expect(mocks.runChat).not.toHaveBeenCalled();
	});
	it("subtracts unfinished reservations from the confirmed free account", async () => {
		mocks.db.lease.aggregate.mockResolvedValue({ _sum: { budget: 999_999n } });
		await expect(runModelChat(owner, input)).rejects.toMatchObject({
			code: "insufficient_balance",
		});
		expect(mocks.db.lease.create).not.toHaveBeenCalled();
	});
	it("fails closed when chain capability or balance is unavailable", async () => {
		mocks.readPrepaidBalance.mockRejectedValue(new Error("RPC unavailable"));
		await expect(runModelChat(owner, input)).rejects.toMatchObject({
			code: "prepaid_unavailable",
			status: 503,
		});
		expect(mocks.sendPrepaidReserve).not.toHaveBeenCalled();
	});
	it.each([
		"offline",
		"paused",
		"expensive",
		"full",
		"opening",
		"locked",
		"unapproved",
	])(
		"skips a %s route before fixing one provider and both prices",
		async (condition) => {
			const first = {
				...listing,
				connectorSeenAt: new Date(),
				connectorCatalog: [listing.model],
			};
			if (condition === "offline") first.connectorSeenAt = new Date(0);
			if (condition === "paused") first.enabled = false;
			if (condition === "expensive") first.inputRate = model.inputRate + 1;
			if (condition === "unapproved") {
				first.transport = "direct";
				first.baseUrl = "https://unapproved.example/v1";
				mocks.gateway.mockRejectedValue(
					new AppError("connector_not_allowed", "unapproved", 403),
				);
			}
			if (condition === "full")
				mocks.db.meterRequest.count.mockResolvedValueOnce(1);
			if (condition === "opening")
				mocks.db.lease.count.mockResolvedValueOnce(1);
			if (condition === "locked")
				mocks.db.$queryRaw.mockResolvedValueOnce([{ locked: false }]);
			mocks.db.modelProduct.findUnique.mockResolvedValue({
				...model,
				routes: [{ ...route, listing: first }, alternative],
			});
			await runModelChat(owner, input);
			expect(mocks.db.lease.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					listingId: alternative.listing.id,
					provider: listing.owner,
					model: model.id,
					upstreamModel: listing.model,
					fundingSource: "PREPAID",
					budget: 33024,
					inputRate: model.inputRate,
					outputRate: model.outputRate,
					providerInputRate: listing.inputRate,
					providerOutputRate: listing.outputRate,
				}),
			});
			expect(mocks.sendPrepaidReserve).toHaveBeenCalledTimes(1);
			expect(mocks.runChat).toHaveBeenCalledTimes(1);
		},
	);
	it("returns capacity error without allocating when all upstreams are busy", async () => {
		mocks.db.meterRequest.count.mockResolvedValue(1);
		await expect(runModelChat(owner, input)).rejects.toMatchObject({
			code: "model_capacity",
			status: 429,
		});
		expect(mocks.db.lease.create).not.toHaveBeenCalled();
	});
	it("never infers before a reservation is confirmed", async () => {
		mocks.sendPrepaidReserve.mockRejectedValue(new Error("receipt unknown"));
		await expect(runModelChat(owner, input)).rejects.toMatchObject({
			code: "reservation_pending",
		});
		expect(mocks.reject).toHaveBeenCalledTimes(1);
		expect(mocks.runChat).not.toHaveBeenCalled();
	});
	it("never retries on another route after an uncertain upstream execution", async () => {
		mocks.runChat.mockRejectedValue(
			new AppError("usage_pending_review", "retain funds", 409),
		);
		await expect(runModelChat(owner, input)).rejects.toMatchObject({
			code: "usage_pending_review",
		});
		expect(mocks.runChat).toHaveBeenCalledTimes(1);
		expect(mocks.db.lease.create).toHaveBeenCalledTimes(1);
		expect(mocks.db.lease.updateMany).toHaveBeenLastCalledWith({
			where: { id: expect.any(String), status: "ACTIVE" },
			data: { status: "CLOSING" },
		});
	});
});
it("shows unavailable prepaid service as an error rather than a zero balance", async () => {
	mocks.readPrepaidBalance.mockRejectedValue(new Error("old escrow"));
	await expect(
		prepaidAccount({ address: owner, name: "buyer", demo: false }),
	).rejects.toMatchObject({ code: "prepaid_unavailable" });
});
