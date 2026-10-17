import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processSettlementQueue } from "./settlement";

const mocks = vi.hoisted(() => ({
	findMany: vi.fn(),
	findRequest: vi.fn(),
	updateRequest: vi.fn(),
	transaction: vi.fn(),
	lock: vi.fn(),
}));
vi.mock("~/server/db", () => ({
	db: {
		lease: { findMany: mocks.findMany },
		meterRequest: {
			findMany: mocks.findRequest,
			updateMany: mocks.updateRequest,
		},
		$transaction: mocks.transaction,
	},
}));
vi.mock("./runtime", () => ({ ensureChainBinding: vi.fn() }));
vi.mock("./market", () => ({ lock: mocks.lock }));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.findRequest.mockResolvedValue([]);
	mocks.transaction.mockImplementation(
		(
			action: (tx: {
				meterRequest: { updateMany: typeof mocks.updateRequest };
			}) => Promise<unknown>,
		) => action({ meterRequest: { updateMany: mocks.updateRequest } }),
	);
});

describe("bounded settlement worker", () => {
	it("checks pending work first and audits active leases in pages", async () => {
		const active = Array.from({ length: 10 }, (_, index) => ({
			id: `active-${index.toString().padStart(2, "0")}`,
		}));
		mocks.findMany.mockImplementation(
			async ({ where }: Prisma.LeaseFindManyArgs) =>
				where?.status === "ACTIVE" ? active : [{ id: "ready-1" }],
		);
		const results = await processSettlementQueue();
		expect(results).toHaveLength(11);
		expect(results[0]?.sessionId).toBe("ready-1");
		expect(results.map((row) => row.sessionId)).toEqual([
			"ready-1",
			...active.map((row) => row.id),
		]);
		expect(mocks.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ status: "ACTIVE" }),
				take: 10,
				orderBy: { id: "asc" },
			}),
		);
		mocks.findMany.mockClear();
		mocks.findMany.mockResolvedValue([]);
		await processSettlementQueue();
		expect(mocks.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					status: "ACTIVE",
					id: { gt: "active-09" },
				}),
			}),
		);
	});

	it("paginates interrupted requests before touching eligible settlement work", async () => {
		const stale = Array.from({ length: 100 }, (_, index) => ({
			id: `stale-${index.toString().padStart(3, "0")}`,
			sessionId: `lease-${index}`,
		}));
		mocks.findRequest.mockResolvedValueOnce(stale).mockResolvedValueOnce([]);
		mocks.findMany.mockResolvedValue([]);
		const first = await processSettlementQueue();
		expect(first).toEqual([]);
		expect(mocks.findRequest).toHaveBeenCalledWith(
			expect.objectContaining({ take: 100, orderBy: { id: "asc" } }),
		);
		await processSettlementQueue();
		expect(mocks.findRequest).toHaveBeenLastCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ id: { gt: "stale-099" } }),
			}),
		);
	});
});
