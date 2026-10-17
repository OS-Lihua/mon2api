import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectorUpdate } from "~/shared/connector";
import { connectorOnline } from "./connector-availability";
import {
	authenticateConnector,
	connectorSetup,
	createConnectorLaunch,
	createLocalDraft,
	pollConnector,
	publishLocalDraft,
	redeemConnectorLaunch,
	reportConnectorCatalog,
	rotateConnector,
	runLocalConnector,
	updateConnector,
} from "./local-connector";
import { localListingInput } from "./local-connector.schema";

const mocks = vi.hoisted(() => ({
	db: {
		$transaction: vi.fn(),
		$queryRaw: vi.fn(),
		listing: {
			findUnique: vi.fn(),
			findUniqueOrThrow: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
			create: vi.fn(),
		},
		connectorJob: {
			count: vi.fn(),
			findFirst: vi.fn(),
			findUnique: vi.fn(),
			findUniqueOrThrow: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
		},
		meterRequest: { updateMany: vi.fn() },
		lease: { count: vi.fn() },
	},
}));
vi.mock("~/server/db", () => ({ db: mocks.db }));
const token = `m2c_${"a".repeat(43)}`;
const credentialHash = createHash("sha256").update(token).digest("hex");
const listing = {
	id: "caaaaaaaaaaaaaaaaaaaaaaaa",
	owner: "owner",
	transport: "local",
	model: "test-model",
	enabled: true,
	connectorHash: credentialHash,
	connectorSeenAt: new Date(),
};
const payload = {
	model: listing.model,
	messages: [{ role: "user" as const, content: "hello" }],
	maxTokens: 128,
	conversationId: "a".repeat(64),
};
const job = {
	id: "cbbbbbbbbbbbbbbbbbbbbbbbb",
	requestId: "request",
	listingId: listing.id,
	payload,
	claimedBy: credentialHash,
	status: "CLAIMED",
	text: "hello",
	revision: 1,
	expiresAt: new Date(Date.now() + 30000),
};
beforeEach(() => {
	vi.resetAllMocks();
	mocks.db.$transaction.mockImplementation(
		(fn: (tx: typeof mocks.db) => Promise<unknown>) => fn(mocks.db),
	);
	mocks.db.listing.findUnique.mockResolvedValue(listing);
	mocks.db.listing.findUniqueOrThrow.mockResolvedValue(listing);
	mocks.db.listing.updateMany.mockResolvedValue({ count: 1 });
	mocks.db.connectorJob.count.mockResolvedValue(0);
	mocks.db.connectorJob.findFirst.mockResolvedValue(null);
	mocks.db.connectorJob.findUnique.mockResolvedValue(job);
	mocks.db.connectorJob.create.mockResolvedValue(job);
	mocks.db.connectorJob.updateMany.mockResolvedValue({ count: 1 });
	mocks.db.lease.count.mockResolvedValue(0);
});
describe("local connector credential and delivery boundaries", () => {
	it.each([null, "Bearer m2a_abc", "Bearer secret", "m2c_bad"])(
		"rejects non-connector credentials %s before querying",
		async (authorization) => {
			await expect(authenticateConnector(authorization)).rejects.toMatchObject({
				status: 401,
			});
			expect(mocks.db.listing.findUnique).not.toHaveBeenCalled();
		},
	);
	it("requires a current hash attached to a local resource", async () => {
		mocks.db.listing.findUnique.mockResolvedValue({
			...listing,
			transport: "direct",
		});
		await expect(
			authenticateConnector(`Bearer ${token}`),
		).rejects.toMatchObject({ status: 401 });
	});
	it("rejects a different model without recording a heartbeat or claiming work", async () => {
		await expect(
			pollConnector(`Bearer ${token}`, "other-model"),
		).rejects.toMatchObject({ code: "model_mismatch" });
		expect(mocks.db.listing.updateMany).not.toHaveBeenCalled();
	});
	it("does not redeliver a claimed job on reconnect", async () => {
		mocks.db.connectorJob.count.mockResolvedValue(1);
		await expect(
			pollConnector(`Bearer ${token}`, listing.model),
		).resolves.toMatchObject({ job: null });
		expect(mocks.db.connectorJob.findFirst).not.toHaveBeenCalled();
	});
	it("does not dispatch jobs for paused resources", async () => {
		mocks.db.listing.findUniqueOrThrow.mockResolvedValue({
			...listing,
			enabled: false,
		});
		await expect(
			pollConnector(`Bearer ${token}`, listing.model),
		).resolves.toMatchObject({ enabled: false, job: null });
		expect(mocks.db.connectorJob.findFirst).not.toHaveBeenCalled();
	});
	it("rejects a job belonging to another resource", async () => {
		mocks.db.connectorJob.findUnique.mockResolvedValue({
			...job,
			listingId: "someone-else",
		});
		await expect(
			updateConnector(`Bearer ${token}`, {
				jobId: job.id,
				event: "progress",
				revision: 2,
				text: "hello!",
			}),
		).rejects.toMatchObject({ status: 404 });
		expect(mocks.db.connectorJob.update).not.toHaveBeenCalled();
	});
	it("acknowledges a replayed revision without changing output or running inference", async () => {
		await expect(
			updateConnector(`Bearer ${token}`, {
				jobId: job.id,
				event: "progress",
				revision: 1,
				text: "hello",
			}),
		).resolves.toEqual({ ok: true });
		expect(mocks.db.connectorJob.update).not.toHaveBeenCalled();
	});
	it("rejects rewritten output and expired updates", async () => {
		await expect(
			updateConnector(`Bearer ${token}`, {
				jobId: job.id,
				event: "progress",
				revision: 2,
				text: "replacement",
			}),
		).rejects.toMatchObject({ status: 409 });
		mocks.db.connectorJob.findUnique.mockResolvedValue({
			...job,
			expiresAt: new Date(0),
		});
		await expect(
			updateConnector(`Bearer ${token}`, {
				jobId: job.id,
				event: "progress",
				revision: 2,
				text: "hello!",
			}),
		).rejects.toMatchObject({ code: "job_expired" });
	});
	it("revokes the old credential without changing ownership or granting wallet access", async () => {
		await rotateConnector(
			{ address: "owner", name: "Seller", demo: false },
			listing.id,
		);
		expect(mocks.db.listing.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: listing.id, owner: "owner", transport: "local" },
				data: expect.objectContaining({
					connectorHash: expect.any(String),
					connectorSeenAt: null,
				}),
			}),
		);
	});
	it.each([true, false])(
		"releases only a job cancelled before claim: %s",
		async (unclaimed) => {
			mocks.db.connectorJob.findUniqueOrThrow.mockResolvedValue({
				...job,
				status: "QUEUED",
				text: "",
				expiresAt: new Date(0),
			});
			mocks.db.connectorJob.updateMany.mockResolvedValue({
				count: unclaimed ? 1 : 0,
			});
			await expect(
				runLocalConnector(
					listing.id,
					"request",
					{ kind: "gateway", ...payload },
					() => {},
					new AbortController().signal,
				),
			).rejects.toMatchObject({ pendingReview: !unclaimed });
		},
	);
	it("rejects offline supply before dispatch", async () => {
		mocks.db.listing.findUniqueOrThrow.mockResolvedValue({
			...listing,
			connectorSeenAt: new Date(0),
		});
		await expect(
			runLocalConnector(
				listing.id,
				"request",
				{ kind: "gateway", ...payload },
				() => {},
				new AbortController().signal,
			),
		).rejects.toMatchObject({ pendingReview: false });
		expect(mocks.db.connectorJob.create).not.toHaveBeenCalled();
	});
});
describe("one-copy connector launch", () => {
	const code = `m2l_${"b".repeat(43)}`;
	it("creates a short-lived code under the signed-in owner without replacing the active connection", async () => {
		const result = await createConnectorLaunch(
			{ address: "owner", name: "Seller", demo: false },
			listing.id,
		);
		expect(result.code).toMatch(/^m2l_[\w-]{43}$/);
		const data = mocks.db.listing.updateMany.mock.calls[0]?.[0].data;
		expect(data.connectorLaunchHash).toBe(
			createHash("sha256").update(result.code).digest("hex"),
		);
		expect(data).not.toHaveProperty("connectorHash");
		expect(new Date(result.expiresAt).getTime() - Date.now()).toBeGreaterThan(
			290000,
		);
		expect(mocks.db.listing.updateMany.mock.calls[0]?.[0].where).toEqual({
			id: listing.id,
			owner: "owner",
			transport: "local",
		});
	});
	it("atomically consumes the code, enforces expiry and returns only a new resource credential", async () => {
		const result = await redeemConnectorLaunch(`Bearer ${code}`);
		expect(result.token).toMatch(/^m2c_[\w-]{43}$/);
		expect(mocks.db.listing.updateMany).toHaveBeenCalledWith({
			where: expect.objectContaining({
				id: listing.id,
				connectorLaunchExpiresAt: { gt: expect.any(Date) },
			}),
			data: expect.objectContaining({
				connectorLaunchHash: null,
				connectorLaunchExpiresAt: null,
				connectorHash: createHash("sha256").update(result.token).digest("hex"),
				connectorSeenAt: null,
			}),
		});
	});
	it("rejects expired or consumed codes even when two exchanges race", async () => {
		mocks.db.listing.updateMany.mockResolvedValue({ count: 0 });
		await expect(redeemConnectorLaunch(`Bearer ${code}`)).rejects.toMatchObject(
			{ status: 401 },
		);
	});
	it.each([null, `Bearer ${token}`, "Bearer invalid"])(
		"rejects other credentials before lookup",
		async (header) => {
			await expect(redeemConnectorLaunch(header)).rejects.toMatchObject({
				status: 401,
			});
			expect(mocks.db.listing.findUnique).not.toHaveBeenCalled();
		},
	);
	it("never creates launch codes for an unowned resource", async () => {
		mocks.db.listing.updateMany.mockResolvedValue({ count: 0 });
		await expect(
			createConnectorLaunch(
				{ address: "other", name: "Other", demo: false },
				listing.id,
			),
		).rejects.toMatchObject({ status: 404 });
	});
});
describe("automatic local model discovery", () => {
	const seller = { address: "owner", name: "Seller", demo: false };
	const draft = {
		...listing,
		status: "DISCOVERING",
		model: "",
		enabled: false,
		connectorCatalog: ["magpie/model"],
		connectorCatalogAt: new Date(),
	};
	const selection = {
		id: listing.id,
		model: "magpie/model",
		inputRate: 1000000,
		outputRate: 2000000,
	};
	it("creates an unpublished connection without a user-supplied model or price", async () => {
		mocks.db.listing.create.mockResolvedValue({ id: listing.id });
		await createLocalDraft(seller, {
			name: "Magpie",
			description: "Local models",
			kind: "gateway",
			connectionMode: "api",
			concurrency: 1,
		});
		expect(mocks.db.listing.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					model: "",
					enabled: false,
					status: "DISCOVERING",
					owner: seller.address,
				}),
			}),
		);
	});
	it("allows the connector to report only its catalog, without changing model, owner or price", async () => {
		await reportConnectorCatalog(`Bearer ${token}`, ["magpie/model"]);
		expect(mocks.db.listing.updateMany).toHaveBeenCalledWith({
			where: { id: listing.id, connectorHash: credentialHash },
			data: {
				connectorCatalog: ["magpie/model"],
				connectorCatalogAt: expect.any(Date),
			},
		});
	});
	it("does not expose a private catalog to another merchant", async () => {
		await expect(
			connectorSetup({ ...seller, address: "other" }, listing.id),
		).rejects.toMatchObject({ status: 404 });
	});
	it("publishes only a discovered model on a fresh, live, owned draft", async () => {
		mocks.db.listing.findUnique.mockResolvedValue(draft);
		await expect(publishLocalDraft(seller, selection)).resolves.toEqual({
			ok: true,
		});
		expect(mocks.db.listing.update).toHaveBeenCalledWith({
			where: { id: listing.id },
			data: {
				model: selection.model,
				inputRate: selection.inputRate,
				outputRate: selection.outputRate,
				enabled: true,
				status: "READY",
			},
		});
	});
	it.each([
		{ model: "other", code: "model_not_available" },
		{ status: "READY", code: "model_locked" },
		{ connectorSeenAt: new Date(0), code: "connector_offline" },
		{ connectorCatalogAt: new Date(0), code: "connector_offline" },
	])(
		"rejects an unreported model, stale catalog, offline draft or model rebind",
		async ({ model, code, ...changes }) => {
			mocks.db.listing.findUnique.mockResolvedValue({ ...draft, ...changes });
			await expect(
				publishLocalDraft(seller, {
					...selection,
					...(model ? { model } : {}),
				}),
			).rejects.toMatchObject({ code });
			expect(mocks.db.listing.update).not.toHaveBeenCalled();
		},
	);
	it("never rebinds a resource which already has a lease", async () => {
		mocks.db.listing.findUnique.mockResolvedValue(draft);
		mocks.db.lease.count.mockResolvedValue(1);
		await expect(publishLocalDraft(seller, selection)).rejects.toMatchObject({
			code: "model_locked",
		});
	});
	it("keeps unselected drafts and missing upstream models from dispatching", async () => {
		mocks.db.listing.findUnique.mockResolvedValue(draft);
		mocks.db.listing.findUniqueOrThrow.mockResolvedValue(draft);
		await expect(pollConnector(`Bearer ${token}`)).resolves.toMatchObject({
			enabled: false,
			job: null,
		});
		expect(mocks.db.connectorJob.findFirst).not.toHaveBeenCalled();
		expect(connectorOnline({ ...listing, connectorCatalog: [] })).toBe(false);
	});
});
describe("local resource contract", () => {
	const input = {
		kind: "gateway",
		name: "Local resource",
		description: "Local text inference",
		model: "test-model",
		inputRate: 1,
		outputRate: 2,
	};
	it("accepts API or OAuth pool supply without uploading an upstream secret", () => {
		expect(localListingInput.parse(input)).toMatchObject({
			concurrency: 1,
			connectionMode: "api",
		});
		expect(
			localListingInput.safeParse({ ...input, connectionMode: "oauth_pool" })
				.success,
		).toBe(true);
		for (const extra of [
			{ apiKey: "secret" },
			{ baseUrl: "https://upstream.example" },
			{ concurrency: 2 },
		])
			expect(localListingInput.safeParse({ ...input, ...extra }).success).toBe(
				false,
			);
	});
	it("expires heartbeat availability without treating a pause as a disconnect", () => {
		expect(connectorOnline({ ...listing, enabled: false })).toBe(true);
		expect(connectorOnline({ ...listing, connectorSeenAt: new Date(0) })).toBe(
			false,
		);
	});
	it("rejects unbounded updates and fabricated usage types", () => {
		expect(
			connectorUpdate.safeParse({
				jobId: job.id,
				revision: 2,
				text: "a".repeat(65537),
				event: "progress",
			}).success,
		).toBe(false);
		expect(
			connectorUpdate.safeParse({
				jobId: job.id,
				revision: 2,
				text: "",
				event: "complete",
				result: {
					text: "",
					finishReason: "stop",
					inputTokens: -1,
					outputTokens: 1,
					usageSource: "upstream_reported",
					pendingReview: false,
					upstreamRequestId: null,
				},
			}).success,
		).toBe(false);
	});
});
