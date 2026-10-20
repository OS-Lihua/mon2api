import type { Listing, Prisma } from "@prisma/client";
import { unsealData } from "iron-session";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewer } from "~/shared/token2api";
import {
	confirmSession,
	createListing,
	discoverDirectModels,
	openSession,
	snapshot,
} from "./market";
import { listingInput } from "./token2api.schema";

const mocks = vi.hoisted(() => ({
	db: {
		listing: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
		lease: {
			findMany: vi.fn(),
			findUnique: vi.fn(),
			updateMany: vi.fn(),
			create: vi.fn(),
		},
		meterRequest: { findMany: vi.fn(), groupBy: vi.fn() },
		accessKey: { findMany: vi.fn(), create: vi.fn() },
		$transaction: vi.fn(),
		$queryRaw: vi.fn(),
		settlement: { findMany: vi.fn() },
	},
	clientAsset: "ETH" as "ETH" | "dUSD",
	chainBalances: vi.fn(),
	findSessionOpen: vi.fn(),
	readSession: vi.fn(),
	getChainId: vi.fn(),
	inspectEscrowOwnerGuard: vi.fn(),
	chainConfig: vi.fn(),
	discoverModels: vi.fn(),
}));
vi.mock("./model-discovery", () => ({ discoverModels: mocks.discoverModels }));

vi.mock("~/server/db", () => ({ db: mocks.db }));
vi.mock("./escrow-version", () => ({
	inspectEscrowOwnerGuard: mocks.inspectEscrowOwnerGuard,
}));
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
vi.mock("./chain", () => ({
	chainBalances: mocks.chainBalances,
	findSessionOpen: mocks.findSessionOpen,
	readSession: mocks.readSession,
	clients: () => ({
		config: {
			asset: mocks.clientAsset,
			chainId: 31337,
			escrow: "0x1111111111111111111111111111111111111111",
		},
		publicClient: { getChainId: mocks.getChainId },
	}),
}));
vi.mock("./runtime", () => ({
	ensureChainBinding: vi.fn(),
	validateConnectorUrl: (url: string) => {
		if (new URL(url).origin !== "https://pool.example")
			throw new Error("not allowed");
		return url;
	},
	sessionPassword: () => "test-only-session-password-at-least-32-characters",
	chainConfig: mocks.chainConfig,
}));

const createdAt = new Date("2026-10-17T00:00:00.000Z");
const viewer: Viewer = { address: "consumer", name: "Consumer", demo: true };
const listing: Listing = {
	id: "listing",
	owner: "provider",
	name: "Test resource",
	description: "Snapshot regression fixture",
	model: "test-model",
	kind: "demo",
	transport: "direct",
	connectorHash: null,
	connectorLaunchHash: null,
	connectorLaunchExpiresAt: null,
	connectorSeenAt: null,
	connectorCatalog: null,
	connectorCatalogAt: null,
	inputRate: 1_000_000,
	outputRate: 2_000_000,
	concurrency: 2,
	enabled: true,
	status: "READY",
	baseUrl: null,
	secret: null,
	createdAt,
};
type LeaseRow = Prisma.LeaseGetPayload<{ include: { listing: true } }>;
function lease(overrides: Partial<LeaseRow> = {}): LeaseRow {
	return {
		id: "session",
		listingId: listing.id,
		listing,
		consumer: viewer.address,
		provider: listing.owner,
		model: listing.model,
		inputRate: listing.inputRate,
		outputRate: listing.outputRate,
		termsHash: "terms",
		budget: 100,
		spent: 50,
		reserved: 7,
		settled: 20,
		writtenOff: 30,
		status: "CLOSED",
		expiresAt: createdAt,
		openTx: "open-tx",
		closeTx: "close-tx",
		createdAt,
		...overrides,
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.clientAsset = "ETH";
	mocks.db.$transaction.mockImplementation(async (action) => action(mocks.db));
	mocks.chainConfig.mockReturnValue({
		mode: "local",
		chainId: 31337,
		escrow: "0xescrow",
		token: "0xtoken",
	});
	mocks.db.listing.findMany.mockResolvedValue([listing]);
	mocks.db.lease.findMany.mockResolvedValue([]);
	mocks.db.meterRequest.findMany.mockResolvedValue([]);
	mocks.db.meterRequest.groupBy.mockResolvedValue([]);
	mocks.db.accessKey.findMany.mockResolvedValue([]);
	mocks.db.settlement.findMany.mockResolvedValue([]);
	mocks.getChainId.mockResolvedValue(31337);
	mocks.inspectEscrowOwnerGuard.mockResolvedValue("guarded");
	mocks.chainBalances.mockResolvedValue({
		claimable: "11",
		walletBalance: "99",
	});
});

describe("direct gateway discovery boundaries", () => {
	it("validates the operator allowlist before forwarding an upstream key", async () => {
		await expect(
			discoverDirectModels({
				baseUrl: "https://untrusted.example/v1",
				apiKey: "secret",
			}),
		).rejects.toMatchObject({ code: "connector_not_allowed" });
		expect(mocks.discoverModels).not.toHaveBeenCalled();
		mocks.discoverModels.mockResolvedValue(["provider/model"]);
		await expect(
			discoverDirectModels({
				baseUrl: "https://pool.example/v1",
				apiKey: "secret",
			}),
		).resolves.toEqual({ models: ["provider/model"] });
	});
	it("does not expose provider errors or credentials", async () => {
		mocks.discoverModels.mockRejectedValue(new Error("private upstream key"));
		await expect(
			discoverDirectModels({
				baseUrl: "https://pool.example/v1",
				apiKey: "secret",
			}),
		).rejects.toMatchObject({ code: "discovery_failed" });
	});
});
describe("market snapshot accounting", () => {
	it("shows Ethereum mainnet as unavailable when no deployment is configured", async () => {
		mocks.chainConfig.mockImplementationOnce(() => {
			throw new Error("Missing deployment");
		});
		const result = await snapshot(null);
		expect(result.network).toMatchObject({
			mode: "evm",
			chainId: 1,
			name: "Ethereum",
			asset: "ETH",
			rpcUrl: "https://ethereum.reth.rs/rpc",
			ready: false,
		});
	});
	it.each(["disconnected", "wrong chain"])(
		"retains the configured testnet when its RPC is %s",
		async (failure) => {
			mocks.chainConfig.mockReturnValue({
				mode: "evm",
				chainId: 8453,
				escrow: "0xescrow",
				token: "0xtoken",
			});
			if (failure === "disconnected")
				mocks.getChainId.mockRejectedValueOnce(new Error("RPC disconnected"));
			const result = await snapshot(null);
			expect(result.network).toMatchObject({
				mode: "evm",
				chainId: 8453,
				escrow: "0xescrow",
				token: "0xtoken",
				ready: false,
			});
		},
	);
	it("keeps upstream credentials out of resource snapshots", async () => {
		mocks.db.listing.findMany.mockResolvedValue([
			{ ...listing, kind: "gateway" },
		]);
		const result = await snapshot({ ...viewer, demo: false }, true);
		expect(result.listings[0]).not.toHaveProperty("secret");
		expect(result.listings[0]).not.toHaveProperty("baseUrl");
	});
	it("scopes the user console and all related records to gateway resources", async () => {
		const walletViewer = { ...viewer, demo: false };
		const gateway = { ...listing, kind: "gateway" };
		mocks.db.listing.findMany.mockResolvedValue([gateway]);
		mocks.db.lease.findMany.mockResolvedValueOnce([
			lease({ listing: gateway }),
		]);
		const result = await snapshot(walletViewer, true);
		const sessionWhere = {
			OR: [{ consumer: viewer.address }, { provider: viewer.address }],
			listing: { kind: "gateway" },
		};
		expect(mocks.db.listing.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					kind: "gateway",
					OR: [{ status: { not: "DISCOVERING" } }, { owner: viewer.address }],
				}),
			}),
		);
		expect(mocks.db.lease.findMany).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ where: sessionWhere }),
		);
		for (const query of [
			mocks.db.meterRequest.findMany,
			mocks.db.settlement.findMany,
		]) {
			expect(query).toHaveBeenCalledWith(
				expect.objectContaining({ where: { session: sessionWhere } }),
			);
		}
		expect(mocks.db.accessKey.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					owner: viewer.address,
					session: { listing: { kind: "gateway" } },
				},
			}),
		);
		expect(result.viewer).toEqual(walletViewer);
		expect(result.listings[0]?.kind).toBe("gateway");
		expect(result.metrics.spent).toBe(50);
	});

	it("shows an empty private console for a saved demo identity", async () => {
		mocks.db.listing.findMany.mockResolvedValue([]);
		const result = await snapshot(viewer, true);
		expect(result.viewer).toBeNull();
		expect(result.listings).toEqual([]);
		expect(result.sessions).toEqual([]);
		expect(result.requests).toEqual([]);
		expect(result.keys).toEqual([]);
		expect(result.settlements).toEqual([]);
		expect(result.metrics).toMatchObject({
			requests: 0,
			spent: 0,
			claimable: null,
			walletBalance: null,
		});
		expect(mocks.db.lease.findMany).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ where: { id: "__none__" } }),
		);
		expect(mocks.chainBalances).not.toHaveBeenCalled();
	});

	it("excludes written-off usage from pending and preserves recorded amounts", async () => {
		mocks.db.lease.findMany.mockResolvedValueOnce([lease()]);
		mocks.db.meterRequest.findMany.mockResolvedValue([
			{
				id: "request",
				sessionId: "session",
				session: { model: listing.model, listing },
				status: "COMPLETED",
				inputTokens: 10,
				outputTokens: 20,
				cost: 50,
				usageSource: "upstream_reported",
				upstreamId: "upstream-request",
				createdAt,
				settlement: { status: "UNCOLLECTIBLE" },
			},
		]);
		mocks.db.settlement.findMany.mockResolvedValue([
			{
				id: "written-off-job",
				sessionId: "session",
				amount: 30,
				status: "UNCOLLECTIBLE",
				txHash: null,
				createdAt,
			},
		]);

		const result = await snapshot(viewer);

		expect(result.metrics).toEqual({
			requests: 1,
			inputTokens: 10,
			outputTokens: 20,
			spent: 50,
			settled: 20,
			writtenOff: 30,
			pending: 0,
			claimable: "11",
			walletBalance: "99",
		});
		expect(result.sessions[0]).toMatchObject({
			id: "session",
			budget: 100,
			spent: 50,
			reserved: 7,
			settled: 20,
			writtenOff: 30,
			status: "CLOSED",
			openTx: "open-tx",
			closeTx: "close-tx",
		});
		expect(result.requests[0]).toMatchObject({
			inputTokens: 10,
			outputTokens: 20,
			cost: 50,
			status: "COMPLETED",
			settled: false,
		});
		expect(result.settlements[0]).toMatchObject({
			amount: 30,
			status: "UNCOLLECTIBLE",
		});
	});

	it("totals outstanding usage across sessions without reducing spent", async () => {
		mocks.db.lease.findMany.mockResolvedValueOnce([
			lease(),
			lease({
				id: "active-session",
				spent: 80,
				settled: 20,
				writtenOff: 0,
				status: "ACTIVE",
			}),
		]);

		const result = await snapshot(viewer);

		expect(result.metrics).toMatchObject({
			spent: 130,
			settled: 40,
			writtenOff: 30,
			pending: 60,
		});
		expect(result.sessions.map((s) => s.writtenOff)).toEqual([30, 0]);
	});

	it("retains unknown request usage while excluding it from known token totals", async () => {
		mocks.db.meterRequest.findMany.mockResolvedValue([
			{
				id: "review-request",
				sessionId: "session",
				session: { model: listing.model, listing },
				status: "REVIEW",
				inputTokens: null,
				outputTokens: null,
				cost: 0,
				usageSource: "missing",
				upstreamId: "upstream-unknown",
				createdAt,
				settlement: null,
			},
		]);
		const result = await snapshot(viewer);
		expect(result.requests[0]).toMatchObject({
			status: "REVIEW",
			inputTokens: null,
			outputTokens: null,
		});
		expect(result.metrics).toMatchObject({ inputTokens: 0, outputTokens: 0 });
	});

	it("leaves chain balances unavailable when the RPC cannot be read", async () => {
		mocks.chainBalances.mockRejectedValueOnce(new Error("RPC disconnected"));
		const result = await snapshot(viewer);
		expect(result.metrics).toMatchObject({
			claimable: null,
			walletBalance: null,
		});
	});

	it("returns zero accounting totals when no sessions are visible", async () => {
		const result = await snapshot(null);

		expect(result.metrics).toMatchObject({
			spent: 0,
			settled: 0,
			writtenOff: 0,
			pending: 0,
			claimable: null,
			walletBalance: null,
		});
		expect(result.sessions).toEqual([]);
		expect(mocks.chainBalances).not.toHaveBeenCalled();
	});
});

describe("resource connection persistence", () => {
	it("encrypts the inference key under the resource owner", async () => {
		mocks.db.listing.create.mockResolvedValue({ id: "resource-id" });
		const input = listingInput.parse({
			name: "My resource",
			description: "Provider resource",
			model: "example-model",
			kind: "gateway",
			baseUrl: "https://pool.example/v1",
			apiKey: "test-dedicated-inference-key",
			inputRate: 1,
			outputRate: 2,
		});
		expect(await createListing(viewer, input)).toEqual({ id: "resource-id" });
		const args = mocks.db.listing.create.mock.calls[0]?.[0];
		expect(args).toMatchObject({
			data: { owner: viewer.address, baseUrl: input.baseUrl },
			select: { id: true },
		});
		expect(args.data.secret).not.toContain(input.apiKey);
		expect(
			await unsealData(args.data.secret, {
				password: "test-only-session-password-at-least-32-characters",
				ttl: 0,
			}),
		).toBe(input.apiKey);
	});
	it("applies the origin allowlist before storing gateway credentials", async () => {
		const input = listingInput.parse({
			name: "My pool",
			description: "Provider pool",
			model: "example-model",
			kind: "gateway",
			baseUrl: "https://unapproved.example/v1",
			apiKey: "test-pool-key",
			inputRate: 1,
			outputRate: 2,
		});
		await expect(createListing(viewer, input)).rejects.toMatchObject({
			code: "connector_not_allowed",
		});
		expect(mocks.db.listing.create).not.toHaveBeenCalled();
	});
});

describe("lease creation guard", () => {
	const consumer: Viewer = {
		address: "0x2222222222222222222222222222222222222222",
		name: "Consumer",
		demo: false,
	};
	const input = { listingId: "clw123456789012345678901234", budget: 1_000_000 };
	it("keeps older escrow sessions available but rejects new leases", async () => {
		mocks.inspectEscrowOwnerGuard.mockResolvedValue("legacy");
		await expect(openSession(consumer, input)).rejects.toMatchObject({
			code: "unsupported_escrow",
			status: 409,
		});
		expect(mocks.db.lease.create).not.toHaveBeenCalled();
	});

	it("rejects new budgets on a legacy dUSD deployment even with an owner guard", async () => {
		mocks.clientAsset = "dUSD";
		await expect(openSession(consumer, input)).rejects.toMatchObject({
			code: "legacy_asset",
		});
		expect(mocks.db.lease.create).not.toHaveBeenCalled();
	});

	it("does not create a draft when the RPC cannot verify the guard", async () => {
		mocks.inspectEscrowOwnerGuard.mockRejectedValue(
			new Error("RPC unavailable"),
		);
		await expect(openSession(consumer, input)).rejects.toMatchObject({
			code: "unsupported_escrow",
			status: 503,
		});
		expect(mocks.db.lease.create).not.toHaveBeenCalled();
	});

	it("creates a wallet-bound random ID for the guarded escrow", async () => {
		mocks.db.listing.findUnique.mockResolvedValue({
			...listing,
			enabled: true,
		});
		mocks.db.lease.create.mockResolvedValue({});
		const result = await openSession(consumer, input);
		expect(result.mode).toBe("wallet");
		expect(result.id).toMatch(
			/^0x2222222222222222222222222222222222222222[\da-f]{24}$/,
		);
		expect(mocks.db.lease.create).toHaveBeenCalledOnce();
	});
});

describe("contract wallet lease activation", () => {
	it("accepts the escrow event from an intermediary transaction when terms and state match", async () => {
		const wallet = "0x1234567890123456789012345678901234567890";
		const provider = "0x9876543210987654321098765432109876543210";
		const id = `0x${"ab".repeat(32)}`;
		const txHash = `0x${"cd".repeat(32)}`;
		const termsHash = `0x${"ef".repeat(32)}`;
		const expiresAt = new Date("2026-10-17T01:00:00.000Z");
		mocks.db.lease.findUnique.mockResolvedValue({
			consumer: wallet,
			provider,
			termsHash,
			budget: 1_000_000,
			expiresAt,
		});
		mocks.findSessionOpen.mockResolvedValue({
			receipt: { from: provider, to: wallet, transactionHash: txHash },
			event: {
				args: {
					consumer: wallet,
					provider,
					termsHash,
					budget: 1_000_000n,
					expiresAt: BigInt(expiresAt.getTime() / 1000),
				},
			},
		});
		mocks.readSession.mockResolvedValue({
			closed: false,
			closeAfter: 0,
			consumer: wallet,
			provider,
			termsHash,
			budget: 1_000_000,
			expiresAt: expiresAt.getTime() / 1000,
		});
		mocks.db.lease.updateMany.mockResolvedValue({ count: 1 });
		const result = await confirmSession(
			{ address: wallet, name: "Contract wallet", demo: false },
			id,
			txHash,
		);
		expect(result).toEqual({ id, status: "ACTIVE" });
		expect(mocks.db.lease.updateMany).toHaveBeenCalledWith({
			where: { id, status: "DRAFT" },
			data: { status: "ACTIVE", openTx: txHash },
		});
	});
});

describe("native token activation credentials", () => {
	const buyer = {
		address: "0x1111111111111111111111111111111111111111",
		name: "Buyer",
		demo: false,
	};
	const provider = "0x2222222222222222222222222222222222222222";
	const id = `0x${"aa".repeat(32)}`;
	const hash = `0x${"bb".repeat(32)}`;
	const termsHash = `0x${"cc".repeat(32)}`;
	beforeEach(() => {
		mocks.chainConfig.mockReturnValue({ asset: "ETH" });
		const expiresAt = new Date(Date.now() + 3600_000);
		mocks.db.lease.findUnique.mockResolvedValue({
			consumer: buyer.address,
			provider,
			termsHash,
			budget: 1_000_000,
			model: "seller/model",
			expiresAt,
		});
		mocks.findSessionOpen.mockResolvedValue({
			receipt: { transactionHash: hash },
			event: {
				args: {
					consumer: buyer.address,
					provider,
					termsHash,
					budget: 1_000_000_000_000_000_000n,
					expiresAt: BigInt(Math.floor(expiresAt.getTime() / 1000)),
				},
			},
		});
		mocks.readSession.mockResolvedValue({
			consumer: buyer.address,
			provider,
			termsHash,
			budget: 1_000_000,
			closed: false,
			closeAfter: 0,
			expiresAt: Math.floor(expiresAt.getTime() / 1000),
		});
	});
	it("issues a hashed, scoped key once after a confirmed native deposit", async () => {
		mocks.db.lease.updateMany
			.mockResolvedValueOnce({ count: 1 })
			.mockResolvedValueOnce({ count: 0 });
		const first = await confirmSession(buyer, id, hash, true);
		expect(first.connection).toMatchObject({
			base_url: "http://localhost:3000/v1",
			model: "seller/model",
			key: expect.stringMatching(/^m2a_[\w-]{43}$/),
		});
		const stored = mocks.db.accessKey.create.mock.calls[0]?.[0]?.data;
		expect(stored).toMatchObject({
			owner: buyer.address,
			sessionId: id,
			hash: expect.stringMatching(/^[\da-f]{64}$/),
		});
		expect(stored).not.toHaveProperty("key");
		expect(JSON.stringify(stored)).not.toContain(first.connection?.key);
		const replay = await confirmSession(buyer, id, hash, true);
		expect(replay.connection).toBeUndefined();
		expect(mocks.db.accessKey.create).toHaveBeenCalledOnce();
	});
	it("never issues a key for another consumer or a mismatched wei deposit", async () => {
		await expect(
			confirmSession({ ...buyer, address: provider }, id, hash, true),
		).rejects.toMatchObject({ code: "not_found" });
		const event = await mocks.findSessionOpen();
		event.event.args.budget = 1_000_000n;
		mocks.findSessionOpen.mockResolvedValue(event);
		await expect(confirmSession(buyer, id, hash, true)).rejects.toMatchObject({
			code: "invalid_transaction",
		});
		expect(mocks.db.accessKey.create).not.toHaveBeenCalled();
	});
});
