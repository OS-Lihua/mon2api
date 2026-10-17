import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./auth";
import {
	accountBalances,
	getConsumerSession,
	getResource,
	listKeys,
	listRequests,
	listResources,
	listSessions,
	listSettlements,
	lookupRequest,
} from "./commerce";
import { updateListing } from "./market";

const mocks = vi.hoisted(() => ({
	listing: {
		findMany: vi.fn(),
		findFirst: vi.fn(),
		findUnique: vi.fn(),
		updateMany: vi.fn(),
	},
	lease: { findMany: vi.fn(), findFirst: vi.fn() },
	meterRequest: { findMany: vi.fn(), findFirst: vi.fn() },
	accessKey: { findMany: vi.fn() },
	settlement: { findMany: vi.fn() },
	balances: vi.fn(),
}));
vi.mock("~/server/db", () => ({ db: mocks }));
vi.mock("./chain", () => ({ chainBalances: mocks.balances, clients: vi.fn() }));
vi.mock("./auth", () => ({
	AppError: class extends Error {
		constructor(
			public code: string,
			message: string,
			public status = 400,
		) {
			super(message);
		}
	},
}));
const address = `0x${"11".repeat(20)}`;
const other = `0x${"22".repeat(20)}`;
const user = { address, name: "Buyer", demo: false };
const date = new Date("2026-10-17T00:00:00Z");
const query = { limit: 2 };
const resource = {
	id: "caaaaaaaaaaaaaaaaaaaaaaaa",
	owner: address,
	name: "Resource",
	description: "Text gateway",
	model: "example-model",
	kind: "gateway",
	connectionMode: "api",
	inputRate: 1,
	outputRate: 2,
	concurrency: 2,
	enabled: true,
	status: "READY",
	createdAt: date,
};
beforeEach(() => {
	vi.resetAllMocks();
	mocks.listing.findMany.mockResolvedValue([]);
	mocks.lease.findMany.mockResolvedValue([]);
	mocks.meterRequest.findMany.mockResolvedValue([]);
	mocks.accessKey.findMany.mockResolvedValue([]);
	mocks.settlement.findMany.mockResolvedValue([]);
});
describe("commerce read isolation and pagination", () => {
	it("filters OAuth pools without exposing connection credentials", async () => {
		mocks.listing.findMany.mockResolvedValue([
			{ ...resource, connectionMode: "oauth_pool" },
		]);
		const result = await listResources(
			{ ...query, connectionMode: "oauth_pool" },
			address,
		);
		expect(mocks.listing.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { owner: address, connectionMode: "oauth_pool" },
				select: expect.objectContaining({ connectionMode: true }),
			}),
		);
		expect(result.data[0]?.connectionMode).toBe("oauth_pool");
		expect(result.data[0]).not.toHaveProperty("secret");
	});
	it("only discovers enabled resources and selects no connector credentials", async () => {
		mocks.listing.findMany.mockResolvedValue([
			resource,
			{ ...resource, id: "cbbbbbbbbbbbbbbbbbbbbbbbb" },
			{ ...resource, id: "ccccccccccccccccccccccccc" },
		]);
		const result = await listResources({
			...query,
			q: "example",
			kind: "gateway",
			cursor: resource.id,
		});
		expect(result).toMatchObject({
			data: [{ id: resource.id }, { id: "cbbbbbbbbbbbbbbbbbbbbbbbb" }],
			hasMore: true,
			nextCursor: "cbbbbbbbbbbbbbbbbbbbbbbbb",
		});
		const args = mocks.listing.findMany.mock.calls[0]?.[0];
		expect(args.where).toMatchObject({
			enabled: true,
			kind: "gateway",
			OR: [
				{ name: { contains: "example", mode: "insensitive" } },
				{ model: { contains: "example", mode: "insensitive" } },
			],
		});
		expect(args).toMatchObject({
			take: 3,
			cursor: { id: resource.id },
			skip: 1,
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		});
		expect(args.select).not.toHaveProperty("secret");
		expect(args.select).not.toHaveProperty("baseUrl");
	});
	it("restricts merchant resource reads to the owner and includes paused rows", async () => {
		await listResources(query, address);
		expect(mocks.listing.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { owner: address } }),
		);
		mocks.listing.findFirst.mockResolvedValue(null);
		await expect(getResource(resource.id, address)).rejects.toMatchObject({
			status: 404,
		});
		expect(mocks.listing.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: resource.id, owner: address } }),
		);
	});
	it("filters consumer sessions and never treats a provider as its consumer", async () => {
		await listSessions(user, query);
		expect(mocks.lease.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { consumer: address } }),
		);
		mocks.lease.findFirst.mockResolvedValue(null);
		await expect(getConsumerSession(user, "session")).rejects.toMatchObject({
			status: 404,
		});
		expect(mocks.lease.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: "session", consumer: address } }),
		);
	});
	it.each(["consumer", "provider"] as const)(
		"scopes %s requests and settlements even when a session filter is supplied",
		async (side) => {
			const filter = { ...query, sessionId: `0x${"33".repeat(32)}` };
			await listRequests(user, side, {
				...filter,
				idempotencyKey: "stable-request-key",
			});
			expect(mocks.meterRequest.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: {
						session: { [side]: address },
						sessionId: filter.sessionId,
						idempotencyKey: "stable-request-key",
					},
				}),
			);
			await listSettlements(user, side, filter);
			expect(mocks.settlement.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { session: { [side]: address }, sessionId: filter.sessionId },
				}),
			);
		},
	);
	it("lists only owned key metadata without key hashes", async () => {
		await listKeys(user, query);
		const args = mocks.accessKey.findMany.mock.calls[0]?.[0];
		expect(args.where).toEqual({ owner: address });
		expect(args.select).not.toHaveProperty("hash");
		expect(args.select).not.toHaveProperty("owner");
	});
	it("binds idempotency lookup to both the inference key's session and consumer", async () => {
		mocks.meterRequest.findFirst.mockResolvedValue(null);
		await expect(
			lookupRequest({ owner: address, sessionId: "own-session" }, "same-key"),
		).rejects.toMatchObject({ status: 404 });
		expect(mocks.meterRequest.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					sessionId: "own-session",
					idempotencyKey: "same-key",
					session: { consumer: address },
				},
			}),
		);
	});
	it("retains null token counts, reservations and REVIEW state", async () => {
		mocks.meterRequest.findMany.mockResolvedValue([
			{
				id: "request",
				sessionId: "session",
				status: "REVIEW",
				inputTokens: null,
				outputTokens: null,
				reservation: 17,
				cost: 0,
				usageSource: "missing",
				upstreamId: null,
				errorCode: "incomplete_stream",
				createdAt: date,
			},
		]);
		expect((await listRequests(user, "consumer", query)).data[0]).toMatchObject(
			{
				status: "REVIEW",
				inputTokens: null,
				outputTokens: null,
				reservation: 17,
				upstreamRequestId: null,
			},
		);
	});
	it("does not fabricate zero balances on an RPC failure", async () => {
		mocks.balances.mockRejectedValue(new Error("private RPC details"));
		await expect(accountBalances(user)).rejects.toMatchObject({
			code: "chain_unavailable",
			status: 503,
		});
	});
});
describe("resource edits preserve financial snapshots", () => {
	it("keeps local resources single-concurrency", async () => {
		mocks.listing.findUnique.mockResolvedValue({
			...resource,
			transport: "local",
		});
		await expect(
			updateListing(user, resource.id, { concurrency: 2 }),
		).rejects.toMatchObject({ code: "invalid_concurrency", status: 400 });
		expect(mocks.listing.updateMany).not.toHaveBeenCalled();
	});

	it("updates only the owned listing, not lease price snapshots", async () => {
		mocks.listing.updateMany.mockResolvedValue({ count: 1 });
		await expect(
			updateListing(user, resource.id, { inputRate: 3, outputRate: 4 }),
		).resolves.toEqual({ ok: true });
		expect(mocks.listing.updateMany).toHaveBeenCalledWith({
			where: { id: resource.id, owner: address },
			data: { inputRate: 3, outputRate: 4 },
		});
		expect(mocks.lease.findMany).not.toHaveBeenCalled();
	});
	it("returns a non-enumerating 404 for an unowned listing", async () => {
		mocks.listing.updateMany.mockResolvedValue({ count: 0 });
		await expect(
			updateListing({ ...user, address: other }, resource.id, {
				concurrency: 3,
			}),
		).rejects.toBeInstanceOf(AppError);
	});
});
