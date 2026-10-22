import type { Lease, MeterRequest, Prisma, Settlement } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAdmissionCache, runChat } from "./metering";
import { EngineFailure, type EngineResult } from "./pool-engine";
import { resolveReview } from "./review";
import {
	closeSession,
	processSettlementQueue,
	settleSession,
} from "./settlement";

const mocks = vi.hoisted(() => ({
	db: {
		endpointPolicy: { findMany: vi.fn() },
		$transaction: vi.fn(),
		lease: {
			findUnique: vi.fn(),
			findUniqueOrThrow: vi.fn(),
			findMany: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
		},
		listing: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
		meterRequest: {
			findUnique: vi.fn(),
			findUniqueOrThrow: vi.fn(),
			findMany: vi.fn(),
			count: vi.fn(),
			create: vi.fn(),
			updateMany: vi.fn(),
		},
		settlement: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
		ledgerEntry: { create: vi.fn(), createMany: vi.fn() },
		accessKey: { updateMany: vi.fn() },
		chainTransaction: { updateMany: vi.fn() },
	},
	lock: vi.fn(),
	runEngine: vi.fn(),
	runLocalConnector: vi.fn(),
	readSession: vi.fn(),
	readEscrowPaused: vi.fn(),
	findSettlement: vi.fn(),
	findSessionClose: vi.fn(),
	sendSettlement: vi.fn(),
	sendClose: vi.fn(),
}));
vi.mock("~/server/db", () => ({ db: mocks.db }));
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
vi.mock("./runtime", () => ({
	ensureChainBinding: vi.fn(),
	demoEnabled: () => true,
	sessionPassword: () => "unused",
}));
vi.mock("./market", () => ({ lock: mocks.lock }));
vi.mock("./chain", () => ({
	readEscrowPaused: mocks.readEscrowPaused,
	readSession: mocks.readSession,
	findSettlement: mocks.findSettlement,
	findSessionClose: mocks.findSessionClose,
	sendSettlement: mocks.sendSettlement,
	sendClose: mocks.sendClose,
}));
vi.mock("./local-connector", () => ({
	runLocalConnector: mocks.runLocalConnector,
}));
vi.mock("./pool-engine", async (original) => ({
	...(await original<typeof import("./pool-engine")>()),
	runEngine: mocks.runEngine,
}));
const sessionId = `0x${"12".repeat(32)}`;
const hash = `0x${"34".repeat(32)}`;
const closeHash = `0x${"56".repeat(32)}`;
const listing = {
	id: "listing",
	enabled: true,
	concurrency: 2,
	kind: "demo",
	secret: null,
};
let lease: Lease;
let requests: MeterRequest[];
let jobs: Settlement[];
let entries: {
	kind: string;
	amount: bigint;
	requestId?: string | null;
}[];
let chain: {
	closed: boolean;
	nonce: number;
	spent: number;
	budget: number;
	closeAfter: number;
	expiresAt: number;
};
let transactionTail: Promise<unknown>;
function request(overrides: Partial<MeterRequest> = {}): MeterRequest {
	return {
		id: `request-${requests.length}`,
		sessionId,
		idempotencyKey: `key-${requests.length}`,
		reservation: 133n,
		cost: 0n,
		providerCost: 0n,
		inputTokens: null,
		outputTokens: null,
		status: "RUNNING",
		usageSource: "missing",
		upstreamId: null,
		errorCode: null,
		settlementId: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}
function job(overrides: Partial<Settlement> = {}): Settlement {
	return {
		id: `job-${jobs.length}`,
		sessionId,
		nonce: jobs.length,
		amount: 20n,
		cumulative: 20n,
		providerAmount: 0n,
		providerCumulative: 0n,
		receiptsHash: hash,
		status: "READY",
		txHash: null,
		createdAt: new Date(),
		...overrides,
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function changedAmount(
	current: bigint,
	value: number | bigint | Prisma.BigIntFieldUpdateOperationsInput | undefined,
): bigint {
	if (typeof value === "number" || typeof value === "bigint")
		return BigInt(value);
	return value?.set !== undefined
		? BigInt(value.set)
		: current + BigInt(value?.increment ?? 0) - BigInt(value?.decrement ?? 0);
}
beforeEach(() => {
	resetAdmissionCache();
	vi.clearAllMocks();
	mocks.readEscrowPaused.mockResolvedValue(false);
	lease = {
		id: sessionId,
		listingId: listing.id,
		consumer: "consumer",
		provider: "provider",
		model: "test",
		fundingSource: "WALLET",
		upstreamModel: null,
		providerInputRate: null,
		providerOutputRate: null,
		providerSpent: 0n,
		inputRate: 1000000,
		outputRate: 1000000,
		termsHash: hash,
		budget: 1000n,
		spent: 0n,
		reserved: 0n,
		settled: 0n,
		writtenOff: 0n,
		status: "ACTIVE",
		expiresAt: new Date(Date.now() + 3600000),
		openTx: null,
		closeTx: null,
		createdAt: new Date(),
	};
	requests = [];
	jobs = [];
	entries = [];
	transactionTail = Promise.resolve();
	chain = {
		closed: false,
		nonce: 0,
		spent: 0,
		budget: 1000,
		closeAfter: 0,
		expiresAt: Math.floor(Date.now() / 1000) + 3600,
	};
	// Serialize test transactions and roll back failed callbacks. Real production
	// ordering is enforced by PostgreSQL advisory locks, asserted below.
	mocks.db.$transaction.mockImplementation(
		(fn: (tx: typeof mocks.db) => Promise<unknown>) => {
			const result = transactionTail.then(async () => {
				const snapshot = structuredClone({ lease, requests, jobs, entries });
				try {
					return await fn(mocks.db);
				} catch (error) {
					({ lease, requests, jobs, entries } = snapshot);
					throw error;
				}
			});
			transactionTail = result.catch(() => undefined);
			return result;
		},
	);
	mocks.db.lease.findUnique.mockImplementation(async () => ({
		...lease,
		listing,
	}));
	mocks.db.lease.findUniqueOrThrow.mockImplementation(async () => ({
		...lease,
	}));
	mocks.db.lease.findMany.mockImplementation(
		async ({ where }: Prisma.LeaseFindManyArgs) => {
			const pending =
				jobs.some((r) => r.status === "READY") ||
				requests.some(
					(r) => r.status === "COMPLETED" && r.cost > 0 && !r.settlementId,
				);
			if (where?.status === "ACTIVE")
				return lease.status === "ACTIVE" ? [{ id: sessionId }] : [];
			return pending || lease.status === "CLOSING" ? [{ id: sessionId }] : [];
		},
	);
	mocks.db.lease.update.mockImplementation(
		async ({ data }: Prisma.LeaseUpdateArgs) => {
			lease.spent = changedAmount(lease.spent, data.spent);
			lease.reserved = changedAmount(lease.reserved, data.reserved);
			lease.settled = changedAmount(lease.settled, data.settled);
			lease.writtenOff = changedAmount(lease.writtenOff, data.writtenOff);
			if (typeof data.status === "string") lease.status = data.status;
			if (typeof data.closeTx === "string") lease.closeTx = data.closeTx;
			return { ...lease };
		},
	);
	mocks.db.lease.updateMany.mockImplementation(
		async ({ data }: Prisma.LeaseUpdateManyArgs) => {
			if (lease.status === "CLOSED") return { count: 0 };
			if (typeof data.status === "string") lease.status = data.status;
			return { count: 1 };
		},
	);
	mocks.db.listing.findUniqueOrThrow.mockResolvedValue(listing);
	mocks.db.meterRequest.findUnique.mockResolvedValue(null);
	mocks.db.meterRequest.findUniqueOrThrow.mockImplementation(
		async ({ where }: Prisma.MeterRequestFindUniqueOrThrowArgs) => {
			const row = requests.find((r) => r.id === where.id);
			if (!row) throw new Error("Missing request");
			return { ...row, session: { ...lease } };
		},
	);
	mocks.db.meterRequest.create.mockImplementation(
		async ({ data }: Prisma.MeterRequestCreateArgs) => {
			const row = request({ reservation: BigInt(data.reservation) });
			requests.push(row);
			return { ...row };
		},
	);
	mocks.db.meterRequest.count.mockImplementation(
		async ({ where }: Prisma.MeterRequestCountArgs) =>
			requests.filter((r) =>
				typeof where?.status === "string"
					? r.status === where.status
					: ["RUNNING", "REVIEW"].includes(r.status),
			).length,
	);
	mocks.db.meterRequest.findMany.mockImplementation(
		async ({ where }: Prisma.MeterRequestFindManyArgs) =>
			requests
				.filter(
					(r) =>
						r.status === where?.status &&
						(where?.status === "RUNNING"
							? r.createdAt.getTime() < Date.now() - 90000
							: !r.settlementId && r.cost > 0),
				)
				.map((r) => ({ ...r })),
	);
	mocks.db.meterRequest.updateMany.mockImplementation(
		async ({ where, data }: Prisma.MeterRequestUpdateManyArgs) => {
			let count = 0;
			for (const row of requests) {
				if (where?.id && typeof where.id === "string" && row.id !== where.id)
					continue;
				if (
					where?.id &&
					typeof where.id === "object" &&
					Array.isArray(where.id.in) &&
					!where.id.in.includes(row.id)
				)
					continue;
				if (typeof where?.status === "string" && row.status !== where.status)
					continue;
				if (
					typeof where?.errorCode === "string" &&
					row.errorCode !== where.errorCode
				)
					continue;
				if (where?.createdAt && row.createdAt.getTime() >= Date.now() - 90000)
					continue;
				const cost = changedAmount(row.cost, data.cost);
				Object.assign(row, data, { cost });
				count++;
			}
			return { count };
		},
	);
	mocks.db.settlement.findFirst.mockImplementation(
		async ({ where, orderBy }: Prisma.SettlementFindFirstArgs) => {
			const sorted = jobs
				.filter((r) => !where?.status || r.status === where.status)
				.sort((a, b) => a.nonce - b.nonce);
			const row =
				Array.isArray(orderBy) || orderBy?.nonce !== "desc"
					? sorted[0]
					: sorted.at(-1);
			return row ? { ...row } : null;
		},
	);
	mocks.db.settlement.create.mockImplementation(
		async ({ data }: Prisma.SettlementCreateArgs) => {
			const row = job({
				amount: BigInt(data.amount),
				cumulative: BigInt(data.cumulative),
				nonce: data.nonce,
				receiptsHash: data.receiptsHash,
			});
			jobs.push(row);
			return { ...row };
		},
	);
	mocks.db.settlement.updateMany.mockImplementation(
		async ({ where, data }: Prisma.SettlementUpdateManyArgs) => {
			const row = jobs.find(
				(r) => r.id === where?.id && r.status === where.status,
			);
			if (!row) return { count: 0 };
			Object.assign(row, data);
			return { count: 1 };
		},
	);
	mocks.db.ledgerEntry.create.mockImplementation(
		async ({ data }: Prisma.LedgerEntryCreateArgs) => {
			entries.push({ ...data, amount: BigInt(data.amount) });
		},
	);
	mocks.db.ledgerEntry.createMany.mockImplementation(
		async ({ data }: Prisma.LedgerEntryCreateManyArgs) => {
			for (const row of Array.isArray(data) ? data : [data])
				entries.push({ ...row, amount: BigInt(row.amount) });
		},
	);
	mocks.db.accessKey.updateMany.mockResolvedValue({ count: 1 });
	mocks.readSession.mockImplementation(async () => ({ ...chain }));
	mocks.findSessionClose.mockImplementation(async () => ({
		txHash: closeHash,
		state: { ...chain },
	}));
	mocks.findSettlement.mockResolvedValue(hash);
	mocks.sendSettlement.mockImplementation(
		async (_id: string, cumulative: number, nonce: number) => {
			chain.spent = cumulative;
			chain.nonce = nonce + 1;
			return hash;
		},
	);
});
const args = {
	sessionId,
	messages: [{ role: "user" as const, content: "hello" }],
	idempotencyKey: "request-0001",
	maxTokens: 128,
	conversationId: "test",
};
const result: EngineResult = {
	text: "done",
	finishReason: "stop",
	inputTokens: 5,
	outputTokens: 15,
	pendingReview: false,
	usageSource: "demo",
	upstreamRequestId: "upstream-late",
};
async function interruptAndResolve() {
	const row = requests[0];
	if (!row) throw new Error("Missing running request");
	row.createdAt = new Date(Date.now() - 100000);
	await processSettlementQueue();
	expect(row.status).toBe("REVIEW");
	await resolveReview(row.id, 5, 10, "invoice-verified");
}
describe("metering lifecycle guards", () => {
	it.each([false, true])(
		"does not reserve or execute paid work when a gateway or proxy lacks approval (proxy=%s)",
		async (usesProxy) => {
			const direct = {
				...listing,
				kind: "gateway",
				transport: "direct",
				baseUrl: "https://gateway.example/v1",
				proxyUrl: usesProxy ? "http://proxy.example:8080" : null,
				proxySecret: null,
			};
			mocks.db.lease.findUnique.mockResolvedValue({
				...lease,
				listing: direct,
			});
			mocks.db.endpointPolicy.findMany.mockResolvedValue(
				usesProxy ? [{ kind: "GATEWAY", url: direct.baseUrl }] : [],
			);
			await expect(runChat("consumer", args)).rejects.toMatchObject({
				code: "connector_not_allowed",
			});
			expect(mocks.db.meterRequest.create).not.toHaveBeenCalled();
			expect(mocks.runEngine).not.toHaveBeenCalled();
			expect(lease.reserved).toBe(0n);
		},
	);
	it("does not reserve money or call an upstream while the escrow is paused", async () => {
		mocks.readEscrowPaused.mockResolvedValue(true);
		await expect(runChat("consumer", args)).rejects.toMatchObject({
			code: "settlement_paused",
		});
		expect(mocks.db.meterRequest.create).not.toHaveBeenCalled();
		expect(mocks.runEngine).not.toHaveBeenCalled();
		expect(mocks.runLocalConnector).not.toHaveBeenCalled();
		expect(lease.reserved).toBe(0n);
	});
	it("does not execute paid work when the pause-state RPC fails", async () => {
		mocks.readEscrowPaused.mockRejectedValue(new Error("RPC unavailable"));
		await expect(runChat("consumer", args)).rejects.toThrow("RPC unavailable");
		expect(mocks.db.meterRequest.create).not.toHaveBeenCalled();
		expect(mocks.runEngine).not.toHaveBeenCalled();
	});
	it.each(["success", "missing", "disconnected", "unclaimed"])(
		"preserves prepaid accounting for local supply: %s",
		async (outcome) => {
			const local = {
				...listing,
				kind: "gateway",
				transport: "local",
				connectorSeenAt: new Date(),
			};
			lease.budget = 1000000n;
			mocks.db.lease.findUnique.mockResolvedValue({ ...lease, listing: local });
			mocks.db.listing.findUniqueOrThrow.mockResolvedValue(local);
			if (outcome === "success" || outcome === "missing")
				mocks.runLocalConnector.mockResolvedValue({
					...result,
					usageSource: "upstream_reported",
					...(outcome === "missing"
						? { inputTokens: null, pendingReview: true }
						: {}),
				});
			else
				mocks.runLocalConnector.mockRejectedValue(
					new EngineFailure(
						"aborted",
						"Disconnected",
						504,
						outcome === "disconnected",
					),
				);
			if (outcome === "success") {
				await expect(runChat("consumer", args)).resolves.toMatchObject({
					cost: 20,
				});
				expect(lease).toMatchObject({ spent: 20n, reserved: 0n });
			} else {
				await expect(runChat("consumer", args)).rejects.toBeDefined();
				expect(lease.spent).toBe(0n);
				expect(lease.reserved).toBe(
					outcome === "unclaimed" ? 0n : requests[0]?.reservation,
				);
				expect(requests[0]?.status).toBe(
					outcome === "unclaimed" ? "FAILED" : "REVIEW",
				);
			}
			expect(mocks.runEngine).not.toHaveBeenCalled();
		},
	);

	it("shares one chain read across concurrent admissions for a session", async () => {
		mocks.runEngine.mockResolvedValue(result);
		await Promise.all([
			runChat("consumer", args),
			runChat("consumer", { ...args, idempotencyKey: "request-0002" }),
		]);
		expect(mocks.readSession).toHaveBeenCalledTimes(1);
		expect(lease).toMatchObject({ spent: 40n, reserved: 0n });
	});

	it("captures and releases one reservation after a normal completion", async () => {
		mocks.runEngine.mockResolvedValue(result);
		await expect(runChat("consumer", args)).resolves.toMatchObject({
			cost: 20,
		});
		expect(lease).toMatchObject({ spent: 20n, reserved: 0n });
		expect(entries.map((r) => r.kind)).toEqual([
			"RESERVE",
			"CAPTURE",
			"RELEASE",
		]);
	});
	it("rolls back capture and retains the reservation if ledger persistence fails", async () => {
		mocks.runEngine.mockResolvedValue(result);
		mocks.db.ledgerEntry.createMany.mockRejectedValueOnce(
			new Error("ledger write failed"),
		);
		await expect(runChat("consumer", args)).rejects.toMatchObject({
			code: "execution_pending_review",
		});
		expect(lease).toMatchObject({ spent: 0n, reserved: 133n });
		expect(requests[0]).toMatchObject({ status: "REVIEW", cost: 0n });
		expect(entries.map((r) => r.kind)).toEqual(["RESERVE"]);
	});
	it("keeps a REVIEW reservation and records missing usage without capture", async () => {
		mocks.runEngine.mockResolvedValue({
			...result,
			inputTokens: null,
			pendingReview: true,
		});
		await expect(runChat("consumer", args)).rejects.toMatchObject({
			code: "usage_pending_review",
		});
		expect(lease).toMatchObject({ spent: 0n, reserved: 133n });
		expect(requests[0]).toMatchObject({
			status: "REVIEW",
			errorCode: "usage_missing",
		});
	});
	it("retains the reservation and does not charge or settle an oversized upstream response", async () => {
		mocks.runEngine.mockRejectedValue(
			new EngineFailure(
				"invalid_response",
				"Provider response exceeds the byte limit.",
				502,
				true,
			),
		);
		await expect(runChat("consumer", args)).rejects.toMatchObject({
			code: "invalid_response",
			status: 502,
		});
		expect(lease).toMatchObject({ spent: 0n, reserved: 133n });
		expect(requests[0]).toMatchObject({ status: "REVIEW", cost: 0n });
		expect(entries.map((row) => row.kind)).toEqual(["RESERVE"]);
		await settleSession(sessionId, "consumer");
		expect(mocks.sendSettlement).not.toHaveBeenCalled();
	});
	it.each(["completed", "review", "failure"])(
		"preserves operator evidence and charges once when a late %s arrives",
		async (kind) => {
			const engine = deferred<EngineResult>();
			const started = deferred<void>();
			mocks.runEngine.mockImplementation(() => {
				started.resolve();
				return engine.promise;
			});
			const response = runChat("consumer", args);
			const rejection = expect(response).rejects.toBeInstanceOf(Error);
			await started.promise;
			await interruptAndResolve();
			if (kind === "failure")
				engine.reject(
					new EngineFailure("upstream_unavailable", "late", 503, false),
				);
			else
				engine.resolve(
					kind === "review"
						? { ...result, pendingReview: true, inputTokens: null }
						: result,
				);
			await rejection;
			expect(lease).toMatchObject({ spent: 15n, reserved: 0n });
			expect(requests[0]).toMatchObject({
				status: "COMPLETED",
				cost: 15n,
				inputTokens: 5,
				outputTokens: 10,
				usageSource: "operator_verified",
				errorCode: "evidence:invoice-verified",
			});
			expect(
				entries.filter((r) => ["CAPTURE", "REVIEW_CAPTURE"].includes(r.kind)),
			).toEqual([
				{
					sessionId,
					requestId: "request-0",
					kind: "REVIEW_CAPTURE",
					amount: 15n,
				},
			]);
			expect(mocks.lock).toHaveBeenCalledWith(mocks.db, sessionId);
			await expect(
				resolveReview("request-0", 0, 0, "second"),
			).rejects.toMatchObject({ code: "not_review" });
		},
	);
	it("saves late upstream usage for review without releasing or capturing the reservation", async () => {
		mocks.runEngine.mockImplementation(async () => {
			const row = requests[0];
			if (!row) throw new Error("Missing request");
			row.createdAt = new Date(Date.now() - 100000);
			await processSettlementQueue();
			return result;
		});
		await expect(runChat("consumer", args)).rejects.toMatchObject({
			code: "usage_pending_review",
		});
		expect(lease).toMatchObject({ spent: 0n, reserved: 133n });
		expect(requests[0]).toMatchObject({
			status: "REVIEW",
			errorCode: "late_usage_reported",
			inputTokens: 5,
			outputTokens: 15,
			upstreamId: "upstream-late",
			usageSource: "demo",
		});
		expect(entries.map((entry) => entry.kind)).toEqual(["RESERVE"]);
	});
	it("saves partial late usage in REVIEW after the worker marks an interruption", async () => {
		mocks.runEngine.mockImplementation(async () => {
			const row = requests[0];
			if (!row) throw new Error("Missing request");
			row.createdAt = new Date(Date.now() - 100000);
			await processSettlementQueue();
			return { ...result, inputTokens: null, pendingReview: true };
		});
		await expect(runChat("consumer", args)).rejects.toMatchObject({
			code: "usage_pending_review",
		});
		expect(requests[0]).toMatchObject({
			status: "REVIEW",
			errorCode: "usage_missing",
			inputTokens: null,
			outputTokens: 15,
			upstreamId: "upstream-late",
		});
		expect(lease).toMatchObject({ spent: 0n, reserved: 133n });
	});
});
describe("settlement recovery and forced chain close", () => {
	it("settles cumulative charges above the old 32-bit storage range exactly", async () => {
		lease.budget = 5_000_000_000n;
		lease.spent = 3_000_000_000n;
		chain.budget = 5_000_000_000;
		requests.push(
			request({
				status: "COMPLETED",
				cost: 3_000_000_000n,
				reservation: 3_000_000_000n,
			}),
		);
		await settleSession(sessionId);
		expect(lease.settled).toBe(3_000_000_000n);
		expect(jobs[0]).toMatchObject({
			amount: 3_000_000_000n,
			cumulative: 3_000_000_000n,
			status: "CONFIRMED",
		});
		expect(mocks.sendSettlement).toHaveBeenCalledWith(
			sessionId,
			3_000_000_000,
			0,
			expect.any(String),
		);
	});
	it("does not confirm recovery before the receipt validator completes", async () => {
		jobs.push(job());
		lease.spent = 20n;
		chain.spent = 20;
		chain.nonce = 1;
		const receipt = deferred<string>();
		const started = deferred<void>();
		mocks.findSettlement.mockImplementation(() => {
			started.resolve();
			return receipt.promise;
		});
		const settling = settleSession(sessionId);
		await started.promise;
		expect(jobs[0]?.status).toBe("READY");
		expect(lease.settled).toBe(0n);
		receipt.resolve(hash);
		await settling;
		expect(mocks.findSettlement).toHaveBeenCalledWith(sessionId, 0, hash, 20);
		expect(jobs[0]?.status).toBe("CONFIRMED");
		expect(lease.settled).toBe(20n);
	});
	it("uses the same receipt validator after a send failure", async () => {
		jobs.push(job());
		lease.spent = 20n;
		mocks.sendSettlement.mockImplementation(async () => {
			chain.spent = 20;
			chain.nonce = 1;
			throw new Error("crash after broadcast");
		});
		await settleSession(sessionId);
		expect(mocks.findSettlement).toHaveBeenCalledWith(sessionId, 0, hash, 20);
		expect(entries).toEqual([{ sessionId, kind: "SETTLE", amount: 20n }]);
	});
	it("leaves READY and balances untouched when receipt confirmation fails", async () => {
		jobs.push(job());
		lease.spent = 20n;
		chain.spent = 20;
		chain.nonce = 1;
		mocks.findSettlement.mockRejectedValue(
			new Error("unconfirmed / invalid receipt"),
		);
		await expect(settleSession(sessionId)).rejects.toThrow("invalid receipt");
		expect(jobs[0]?.status).toBe("READY");
		expect(lease.settled).toBe(0n);
		expect(entries).toEqual([]);
	});
	it("recovers a paid batch, writes off later fees and preserves all usage", async () => {
		jobs.push(job());
		requests.push(
			request({
				id: "paid",
				status: "COMPLETED",
				cost: 20n,
				settlementId: "job-0",
			}),
			request({
				id: "unpaid",
				status: "COMPLETED",
				cost: 30n,
				inputTokens: 10,
				outputTokens: 20,
				errorCode: "evidence:bill-2",
				usageSource: "operator_verified",
			}),
		);
		lease.spent = 50n;
		chain = { ...chain, closed: true, spent: 20, nonce: 1 };
		await settleSession(sessionId);
		expect(jobs.map((r) => [r.status, r.amount])).toEqual([
			["CONFIRMED", 20n],
			["UNCOLLECTIBLE", 30n],
		]);
		expect(lease).toMatchObject({
			spent: 50n,
			settled: 20n,
			writtenOff: 30n,
			status: "CLOSED",
			closeTx: closeHash,
		});
		expect(requests[1]).toMatchObject({
			cost: 30n,
			inputTokens: 10,
			outputTokens: 20,
			errorCode: "evidence:bill-2",
			settlementId: "job-1",
		});
		expect(entries.filter((r) => r.kind === "OPERATING_LOSS")).toEqual([
			{ sessionId, kind: "OPERATING_LOSS", amount: 30n },
		]);
		await settleSession(sessionId);
		await closeSession(sessionId, "consumer");
		expect(lease.writtenOff).toBe(30n);
		expect(entries.filter((r) => r.kind === "OPERATING_LOSS")).toHaveLength(1);
		expect(await processSettlementQueue()).toEqual([]);
		expect(mocks.sendSettlement).not.toHaveBeenCalled();
		expect(mocks.sendClose).not.toHaveBeenCalled();
	});
	it("keeps a zero-charge review outcome and its evidence without retrying it", async () => {
		requests.push(request({ status: "REVIEW" }));
		lease.reserved = 133n;
		chain.closed = true;
		await resolveReview("request-0", 0, 0, "zero-usage-confirmed");
		await processSettlementQueue();
		expect(requests[0]).toMatchObject({
			status: "COMPLETED",
			cost: 0n,
			usageSource: "operator_verified",
			errorCode: "evidence:zero-usage-confirmed",
		});
		expect(lease).toMatchObject({
			status: "CLOSED",
			spent: 0n,
			reserved: 0n,
			settled: 0n,
			writtenOff: 0n,
		});
		expect(jobs).toEqual([]);
		expect(await processSettlementQueue()).toEqual([]);
	});
	it("resumes an interrupted close from the worker after settlement", async () => {
		lease.status = "CLOSING";
		mocks.sendClose.mockImplementation(async () => {
			chain.closed = true;
			return closeHash;
		});
		expect(await processSettlementQueue()).toEqual([{ sessionId, ok: true }]);
		expect(lease).toMatchObject({ status: "CLOSED", closeTx: closeHash });
		expect(
			entries.filter((entry) => entry.kind === "REFUND_AVAILABLE"),
		).toHaveLength(1);
		expect(mocks.sendClose).toHaveBeenCalledOnce();
		expect(await processSettlementQueue()).toEqual([]);
	});

	it("keeps normal close refund accounting exactly once", async () => {
		mocks.sendClose.mockImplementation(async () => {
			chain.closed = true;
			return closeHash;
		});
		await expect(closeSession(sessionId, "consumer")).resolves.toEqual({
			txHash: closeHash,
		});
		await closeSession(sessionId, "consumer");
		expect(lease).toMatchObject({
			status: "CLOSED",
			settled: 0n,
			writtenOff: 0n,
			closeTx: closeHash,
		});
		expect(entries.filter((r) => r.kind === "REFUND_AVAILABLE")).toEqual([
			{ sessionId, kind: "REFUND_AVAILABLE", amount: 1000n },
		]);
	});
	it("does not write off on an unconfirmed close or unexplained chain spend", async () => {
		jobs.push(job());
		lease.spent = 20n;
		chain.closed = true;
		mocks.findSessionClose.mockRejectedValueOnce(
			new Error("close is unconfirmed"),
		);
		await expect(settleSession(sessionId)).rejects.toThrow("unconfirmed");
		expect(jobs[0]?.status).toBe("READY");
		expect(lease.writtenOff).toBe(0n);
		chain.spent = 9;
		await expect(settleSession(sessionId)).rejects.toMatchObject({
			code: "settlement_conflict",
		});
		expect(lease).toMatchObject({ status: "ACTIVE", writtenOff: 0n });
	});
	it("rolls back a loss transition if its ledger entry cannot be stored", async () => {
		jobs.push(job());
		lease.spent = 20n;
		chain.closed = true;
		mocks.db.ledgerEntry.create.mockRejectedValueOnce(
			new Error("loss ledger failed"),
		);
		await expect(settleSession(sessionId)).rejects.toThrow(
			"loss ledger failed",
		);
		expect(jobs[0]?.status).toBe("READY");
		expect(lease).toMatchObject({
			status: "ACTIVE",
			writtenOff: 0n,
			settled: 0n,
		});
		await settleSession(sessionId);
		expect(lease.writtenOff).toBe(20n);
		expect(entries.filter((r) => r.kind === "OPERATING_LOSS")).toHaveLength(1);
	});
	it("records concurrent closure retries only once", async () => {
		jobs.push(job());
		lease.spent = 20n;
		chain.closed = true;
		await Promise.all([settleSession(sessionId), settleSession(sessionId)]);
		expect(lease).toMatchObject({
			spent: 20n,
			settled: 0n,
			writtenOff: 20n,
			status: "CLOSED",
		});
		expect(entries.filter((r) => r.kind === "OPERATING_LOSS")).toHaveLength(1);
		expect(entries.filter((r) => r.kind === "REFUND_AVAILABLE")).toHaveLength(
			1,
		);
	});
	it("closes locally with REVIEW held, then writes off a later operator capture", async () => {
		requests.push(request({ status: "REVIEW" }));
		lease.reserved = 133n;
		chain.closed = true;
		await closeSession(sessionId, "consumer");
		expect(lease).toMatchObject({
			status: "CLOSED",
			reserved: 133n,
			writtenOff: 0n,
		});
		await resolveReview("request-0", 5, 10, "late-invoice");
		await processSettlementQueue();
		expect(lease).toMatchObject({
			status: "CLOSED",
			reserved: 0n,
			spent: 15n,
			settled: 0n,
			writtenOff: 15n,
		});
		expect(requests[0]).toMatchObject({
			cost: 15n,
			usageSource: "operator_verified",
			errorCode: "evidence:late-invoice",
		});
		expect(jobs[0]?.status).toBe("UNCOLLECTIBLE");
	});
});
