import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	listEndpointPolicies,
	operatorResources,
	operatorStatus,
	saveEndpointPolicy,
	setEndpointStatus,
} from "./operator";

const mocks = vi.hoisted(() => ({
	owner: vi.fn(),
	db: {
		endpointPolicy: {
			findMany: vi.fn(),
			findUnique: vi.fn(),
			upsert: vi.fn(),
			update: vi.fn(),
		},
		listing: { groupBy: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
		$transaction: vi.fn(),
	},
}));
vi.mock("~/server/db", () => ({ db: mocks.db }));
vi.mock("./chain", () => ({
	clients: () => ({
		config: { escrow: `0x${"aa".repeat(20)}` },
		publicClient: { readContract: mocks.owner },
	}),
}));
const owner = {
	address: `0x${"11".repeat(20)}`,
	name: "Operator",
	demo: false,
};
const seller = { ...owner, address: `0x${"22".repeat(20)}` };
const entry = {
	id: "caaaaaaaaaaaaaaaaaaaaaaaa",
	kind: "GATEWAY",
	url: "https://gateway.example/v1",
	name: "Gateway",
	note: "",
	enabled: true,
	updatedBy: owner.address,
	createdAt: new Date(),
	updatedAt: new Date(),
};
beforeEach(() => {
	vi.resetAllMocks();
	mocks.owner.mockResolvedValue(owner.address);
	mocks.db.$transaction.mockImplementation(async (action) => action(mocks.db));
	mocks.db.endpointPolicy.findUnique.mockResolvedValue(entry);
});

describe("on-chain operator authority", () => {
	it("requires a signed owner session and follows ownership transfers immediately", async () => {
		expect((await operatorStatus(null)).authorized).toBe(false);
		expect((await operatorStatus({ ...owner, demo: true })).authorized).toBe(
			false,
		);
		expect((await operatorStatus(owner)).authorized).toBe(true);
		mocks.owner.mockResolvedValue(seller.address);
		await expect(listEndpointPolicies(owner)).rejects.toMatchObject({
			status: 403,
		});
		expect((await operatorStatus(seller)).authorized).toBe(true);
		expect(mocks.db.endpointPolicy.findMany).not.toHaveBeenCalled();
	});
	it("rejects merchant reads and mutations before touching policy data", async () => {
		for (const action of [
			() => listEndpointPolicies(seller),
			() => operatorResources(seller, { limit: 25 }),
			() =>
				saveEndpointPolicy(seller, {
					kind: "GATEWAY",
					url: entry.url,
					name: "Gateway",
					note: "",
				}),
			() => setEndpointStatus(seller, { id: entry.id, enabled: false }),
		])
			await expect(action()).rejects.toMatchObject({ status: 403 });
		expect(mocks.db.$transaction).not.toHaveBeenCalled();
		expect(mocks.db.endpointPolicy.upsert).not.toHaveBeenCalled();
	});
	it("fails closed on an owner RPC failure", async () => {
		mocks.owner.mockRejectedValue(new Error("RPC unavailable"));
		await expect(
			setEndpointStatus(owner, { id: entry.id, enabled: false }),
		).rejects.toThrow();
		expect(mocks.db.$transaction).not.toHaveBeenCalled();
	});
});

describe("endpoint lifecycle", () => {
	it("stops matching direct resources without changing leases or settlement records", async () => {
		await setEndpointStatus(owner, { id: entry.id, enabled: false });
		expect(mocks.db.listing.updateMany).toHaveBeenCalledWith({
			where: { kind: "gateway", transport: "direct", baseUrl: entry.url },
			data: { enabled: false, status: "BLOCKED" },
		});
		mocks.db.endpointPolicy.findUnique.mockResolvedValue({
			...entry,
			kind: "PROXY",
		});
		await setEndpointStatus(owner, { id: entry.id, enabled: false });
		expect(mocks.db.listing.updateMany).toHaveBeenLastCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ proxyUrl: entry.url }),
			}),
		);
	});
	it("does not silently relaunch resources when re-enabling an endpoint", async () => {
		await setEndpointStatus(owner, { id: entry.id, enabled: true });
		expect(mocks.db.listing.updateMany).not.toHaveBeenCalled();
	});
	it("does not silently enable a disabled entry while editing its description", async () => {
		await saveEndpointPolicy(owner, {
			kind: "GATEWAY",
			url: entry.url,
			name: "Renamed",
			note: "Reviewed",
		});
		expect(mocks.db.endpointPolicy.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				update: { name: "Renamed", note: "Reviewed", updatedBy: owner.address },
				select: { id: true },
			}),
		);
	});
	it("selects only non-secret fields when an operator views associated resources", async () => {
		mocks.db.listing.findMany.mockResolvedValue([]);
		await operatorResources(owner, { endpointId: entry.id, limit: 25 });
		const query = mocks.db.listing.findMany.mock.calls[0]?.[0];
		expect(query.where).toEqual({ transport: "direct", baseUrl: entry.url });
		expect(query.select).not.toHaveProperty("secret");
		expect(query.select).not.toHaveProperty("proxySecret");
	});
});
