import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processSettlementQueue } from "./settlement";

const mocks = vi.hoisted(() => ({
	findMany: vi.fn(),
	findRequest: vi.fn(),
	updateRequest: vi.fn(),
	transaction: vi.fn(),
	lock: vi.fn(),
	findLease: vi.fn(),
	readSession: vi.fn(),
}));
vi.mock("~/server/db", () => ({
	db: {
		lease: {
			findMany: mocks.findMany,
			findUnique: mocks.findLease,
			findUniqueOrThrow: mocks.findLease,
		},
		meterRequest: {
			findMany: mocks.findRequest,
			updateMany: mocks.updateRequest,
		},
		$transaction: mocks.transaction,
	},
}));
vi.mock("./runtime", () => ({ ensureChainBinding: vi.fn() }));
vi.mock("./market", () => ({ lock: mocks.lock }));
vi.mock("./chain", () => ({
	readSession: mocks.readSession,
	findSessionClose: vi.fn(),
	findSettlement: vi.fn(),
	sendClose: vi.fn(),
	sendSettlement: vi.fn(),
}));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.findRequest.mockResolvedValue([]);
	mocks.findLease.mockImplementation(
		async ({ where }: { where: { id: string } }) => ({
			id: where.id,
			status: "ACTIVE",
		}),
	);
	mocks.readSession.mockResolvedValue({ closed: false, spent: 0, nonce: 0 });
	mocks.transaction.mockImplementation(
		(
			action: (tx: {
				meterRequest: {
					updateMany: typeof mocks.updateRequest;
					findMany: typeof mocks.findRequest;
				};
				lease: { findUniqueOrThrow: typeof mocks.findLease };
				settlement: { findFirst: () => Promise<null> };
			}) => Promise<unknown>,
		) =>
			action({
				meterRequest: {
					updateMany: mocks.updateRequest,
					findMany: mocks.findRequest,
				},
				lease: { findUniqueOrThrow: mocks.findLease },
				settlement: { findFirst: async () => null },
			}),
	);
});

describe("bounded settlement worker", () => {
	it("continues other sessions while one chain confirmation is slow, with at most four in flight", async () => {
		const pending = Array.from({ length: 8 }, (_, index) => ({
			id: `parallel-${index}`,
		}));
		mocks.findMany.mockImplementation(
			async ({ where }: Prisma.LeaseFindManyArgs) =>
				where?.status === "ACTIVE" ? [] : pending,
		);
		let release!: () => void;
		const waiting = new Promise<void>((resolve) => {
			release = resolve;
		});
		let active = 0;
		let peak = 0;
		mocks.readSession.mockImplementation(async (id: string) => {
			active++;
			peak = Math.max(peak, active);
			try {
				if (id === "parallel-0") await waiting;
				await Promise.resolve();
				return { closed: false, spent: 0, nonce: 0 };
			} finally {
				active--;
			}
		});
		const processing = processSettlementQueue();
		try {
			await vi.waitFor(() =>
				expect(mocks.readSession).toHaveBeenCalledTimes(8),
			);
		} finally {
			release();
		}
		await expect(processing).resolves.toEqual(
			pending.map(({ id }) => ({ sessionId: id, ok: true })),
		);
		expect(peak).toBeGreaterThan(1);
		expect(peak).toBeLessThanOrEqual(4);
	});
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
