import ganache from "ganache";
import { getIronSession } from "iron-session";
import { createPublicClient, custom, type Hex, hashMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { parseSiweMessage } from "viem/siwe";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { logout, viewer, walletChallenge, walletLogin } from "./auth";

type Challenge = {
	id: string;
	address: string;
	message: string;
	expiresAt: Date;
	consumed: boolean;
};
const mocks = vi.hoisted(() => ({
	rows: new Map<string, Challenge>(),
	create: vi.fn(),
	findUnique: vi.fn(),
	updateMany: vi.fn(),
	publicChain: vi.fn(),
	cookieNames: new Set<string>(),
	session: { viewer: undefined as unknown, save: vi.fn(), destroy: vi.fn() },
}));
vi.mock("~/server/db", () => ({
	db: {
		walletNonce: {
			create: mocks.create,
			findUnique: mocks.findUnique,
			updateMany: mocks.updateMany,
		},
	},
}));
vi.mock("next/headers", () => ({
	cookies: vi.fn(async () => ({
		has: (name: string) => mocks.cookieNames.has(name),
	})),
}));
vi.mock("iron-session", () => ({
	getIronSession: vi.fn(async () => mocks.session),
}));
vi.mock("./chain", () => ({
	clients: mocks.publicChain,
	demoAccount: vi.fn(),
}));
vi.mock("./runtime", () => ({
	chainConfig: () => ({ chainId: 31337 }),
	sessionPassword: () => "test-session-password-at-least-32-characters",
	demoEnabled: () => false,
}));

// Public test keys, used only against the in-memory local chain.
const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const stranger = privateKeyToAccount(`0x${"22".repeat(32)}`);
const contract = "0x0000000000000000000000000000000000000127";
let provider: ReturnType<typeof ganache.provider>;

function rowFor(message: string) {
	const row = mocks.rows.get(message);
	if (!row) throw new Error("Missing challenge fixture");
	return row;
}
async function signedChallenge() {
	const { message } = await walletChallenge(signer.address);
	return { message, signature: await signer.signMessage({ message }) };
}
function replaceChallenge(message: string, next: string) {
	const row = rowFor(message);
	mocks.rows.delete(message);
	mocks.rows.set(next, { ...row, message: next });
}

describe("wallet SIWE authentication", () => {
	beforeAll(() => {
		provider = ganache.provider({
			logging: { quiet: true },
			chain: { chainId: 31337, hardfork: "shanghai" },
			wallet: { deterministic: true },
		});
	});
	afterAll(async () => {
		await provider.disconnect();
	});
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-17T12:00:00.000Z"));
		vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
		mocks.rows.clear();
		mocks.cookieNames.clear();
		vi.clearAllMocks();
		mocks.session.viewer = undefined;
		mocks.session.save.mockResolvedValue(undefined);
		mocks.create.mockImplementation(
			async ({ data }: { data: Omit<Challenge, "id" | "consumed"> }) => {
				const row = {
					...data,
					id: `challenge-${mocks.rows.size}`,
					consumed: false,
				};
				mocks.rows.set(data.message, row);
				return row;
			},
		);
		mocks.findUnique.mockImplementation(
			async ({ where }: { where: { message: string } }) => {
				const row = mocks.rows.get(where.message);
				return row ? { ...row } : null;
			},
		);
		mocks.updateMany.mockImplementation(
			async ({
				where,
			}: {
				where: { id: string; consumed: boolean; expiresAt: { gt: Date } };
			}) => {
				const row = [...mocks.rows.values()].find(
					(item) => item.id === where.id,
				);
				if (
					!row ||
					row.consumed !== where.consumed ||
					row.expiresAt <= where.expiresAt.gt
				)
					return { count: 0 };
				row.consumed = true;
				return { count: 1 };
			},
		);
		mocks.publicChain.mockReturnValue({
			config: { chainId: 31337 },
			publicClient: createPublicClient({
				chain: foundry,
				transport: custom(provider, { retryCount: 0 }),
			}),
		});
	});

	it.each([
		[["mon2api_session"], "mon2api_session"],
		[["token2api_session", "mon2api_session"], "token2api_session"],
	] as const)(
		"reads existing cookies with canonical-cookie priority: %j",
		async (names, expected) => {
			for (const name of names) mocks.cookieNames.add(name);
			mocks.session.viewer = {
				address: signer.address.toLowerCase(),
				name: "Test wallet",
				demo: false,
			};
			expect(await viewer()).toEqual(mocks.session.viewer);
			expect(getIronSession).toHaveBeenLastCalledWith(
				expect.anything(),
				expect.objectContaining({ cookieName: expected }),
			);
		},
	);

	it("clears both session cookie names on logout", async () => {
		await logout();
		expect(mocks.session.destroy).toHaveBeenCalledTimes(2);
		expect(getIronSession).toHaveBeenNthCalledWith(
			1,
			expect.anything(),
			expect.objectContaining({ cookieName: "token2api_session" }),
		);
		expect(getIronSession).toHaveBeenNthCalledWith(
			2,
			expect.anything(),
			expect.objectContaining({ cookieName: "mon2api_session" }),
		);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	it("issues a canonical EIP-4361 message with all expected fields and a five-minute lifetime", async () => {
		const { message } = await walletChallenge(signer.address);
		const fields = parseSiweMessage(message);
		expect(fields).toMatchObject({
			address: signer.address,
			domain: "localhost:3000",
			uri: "http://localhost:3000",
			chainId: 31337,
			version: "1",
			issuedAt: new Date("2026-10-17T12:00:00.000Z"),
			expirationTime: new Date("2026-10-17T12:05:00.000Z"),
		});
		expect(fields.nonce).toMatch(/^[\da-f]{48}$/);
		expect(rowFor(message)).toMatchObject({
			address: signer.address.toLowerCase(),
			expiresAt: fields.expirationTime,
		});
		const second = parseSiweMessage(
			(await walletChallenge(signer.address)).message,
		);
		expect(second.nonce).not.toBe(fields.nonce);
	});

	it("verifies a real EOA signature and saves a normalized iron-session viewer", async () => {
		const { message, signature } = await signedChallenge();
		const user = await walletLogin(signer.address, message, signature);
		expect(user).toMatchObject({
			address: signer.address.toLowerCase(),
			demo: false,
		});
		expect(mocks.session.viewer).toEqual(user);
		expect(mocks.session.save).toHaveBeenCalledOnce();
		expect(rowFor(message).consumed).toBe(true);
	});

	it("rejects another EOA's signature without consuming the challenge", async () => {
		const { message } = await signedChallenge();
		const signature = await stranger.signMessage({ message });
		await expect(
			walletLogin(signer.address, message, signature),
		).rejects.toMatchObject({
			code: "invalid_signature",
			status: 401,
		});
		expect(rowFor(message).consumed).toBe(false);
		expect(mocks.session.save).not.toHaveBeenCalled();
	});

	it("rejects a different message or wallet before verification", async () => {
		const { message, signature } = await signedChallenge();
		await expect(
			walletLogin(signer.address, `${message}\n`, signature),
		).rejects.toMatchObject({
			code: "invalid_challenge",
			status: 401,
		});
		await expect(
			walletLogin(stranger.address, message, signature),
		).rejects.toMatchObject({
			code: "invalid_challenge",
			status: 401,
		});
		expect(mocks.updateMany).not.toHaveBeenCalled();
	});

	it("rejects expired challenges at the exact expiry boundary", async () => {
		const { message, signature } = await signedChallenge();
		vi.setSystemTime(rowFor(message).expiresAt);
		await expect(
			walletLogin(signer.address, message, signature),
		).rejects.toMatchObject({
			code: "invalid_challenge",
			status: 401,
		});
		expect(mocks.publicChain).not.toHaveBeenCalled();
		expect(mocks.session.save).not.toHaveBeenCalled();
	});

	it("rejects replay after one successful login", async () => {
		const { message, signature } = await signedChallenge();
		await walletLogin(signer.address, message, signature);
		await expect(
			walletLogin(signer.address, message, signature),
		).rejects.toMatchObject({
			code: "invalid_challenge",
			status: 401,
		});
		expect(mocks.session.save).toHaveBeenCalledOnce();
	});

	it("allows only one concurrent login for the same challenge", async () => {
		const { message, signature } = await signedChallenge();
		const results = await Promise.allSettled([
			walletLogin(signer.address, message, signature),
			walletLogin(signer.address, message, signature),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			results.find((result) => result.status === "rejected"),
		).toMatchObject({
			reason: { code: "invalid_challenge", status: 401 },
		});
		expect(mocks.updateMany).toHaveBeenCalledTimes(2);
		expect(mocks.session.save).toHaveBeenCalledOnce();
	});

	it("rechecks expiry during atomic consumption if verification crosses expiry", async () => {
		const { message, signature } = await signedChallenge();
		const { publicClient } = mocks.publicChain() as {
			publicClient: ReturnType<typeof createPublicClient>;
		};
		mocks.publicChain.mockReturnValue({
			config: { chainId: 31337 },
			publicClient: publicClient.extend(() => ({
				call: async (...args: Parameters<typeof publicClient.call>) => {
					const result = await publicClient.call(...args);
					vi.setSystemTime(rowFor(message).expiresAt);
					return result;
				},
			})),
		});
		await expect(
			walletLogin(signer.address, message, signature),
		).rejects.toMatchObject({
			code: "invalid_challenge",
			status: 401,
		});
		expect(mocks.session.save).not.toHaveBeenCalled();
	});

	it.each(["0x", "0x1", "0x123", "0xgg", "not-hex", `0x${"ab".repeat(8193)}`])(
		"returns 400 for malformed or oversized signature %#",
		async (signature) => {
			const { message } = await signedChallenge();
			await expect(
				walletLogin(signer.address, message, signature),
			).rejects.toMatchObject({
				code: "invalid_signature",
				status: 400,
			});
			expect(mocks.findUnique).not.toHaveBeenCalled();
			expect(mocks.session.save).not.toHaveBeenCalled();
		},
	);

	it("returns 401 for a well-formed hex signature rejected by viem", async () => {
		const { message } = await signedChallenge();
		await expect(
			walletLogin(signer.address, message, "0x1234"),
		).rejects.toMatchObject({
			code: "invalid_signature",
			status: 401,
		});
	});

	it.each([
		[
			"domain",
			(message: string) =>
				message.replace("localhost:3000 wants", "attacker.example wants"),
		],
		[
			"URI",
			(message: string) =>
				message.replace(
					"URI: http://localhost:3000",
					"URI: https://attacker.example",
				),
		],
		[
			"chainId",
			(message: string) => message.replace("Chain ID: 31337", "Chain ID: 1"),
		],
		[
			"version",
			(message: string) => message.replace("Version: 1", "Version: 2"),
		],
		[
			"nonce",
			(message: string) => message.replace(/Nonce: .+/, "Nonce: badnonce"),
		],
		[
			"issuedAt",
			(message: string) =>
				message.replace(
					"Issued At: 2026-10-17T12:00:00.000Z",
					"Issued At: 2026-10-17T12:01:00.000Z",
				),
		],
		[
			"invalid issuedAt",
			(message: string) =>
				message.replace(/Issued At: .+/, "Issued At: invalid"),
		],
		[
			"expiration",
			(message: string) =>
				message.replace(
					"Expiration Time: 2026-10-17T12:05:00.000Z",
					"Expiration Time: 2026-10-17T12:06:00.000Z",
				),
		],
		[
			"missing expiration",
			(message: string) => message.replace(/\nExpiration Time: .+/, ""),
		],
		["trailing fields", (message: string) => `${message}\nextra`],
	] as const)(
		"rejects stored challenges with unexpected %s",
		async (_field, change) => {
			const { message } = await signedChallenge();
			const changed = change(message);
			replaceChallenge(message, changed);
			const signature = await signer.signMessage({ message: changed });
			await expect(
				walletLogin(signer.address, changed, signature),
			).rejects.toMatchObject({
				code: "invalid_challenge",
				status: 401,
			});
			expect(mocks.updateMany).not.toHaveBeenCalled();
		},
	);

	it("rejects an old challenge after the configured chain changes", async () => {
		const { message, signature } = await signedChallenge();
		const current = mocks.publicChain();
		mocks.publicChain.mockReturnValue({
			...current,
			config: { chainId: 8453 },
		});
		await expect(
			walletLogin(signer.address, message, signature),
		).rejects.toMatchObject({
			code: "invalid_challenge",
			status: 401,
		});
	});

	it("keeps transport failure distinct from invalid signatures and leaves the challenge usable", async () => {
		const { message } = await signedChallenge();
		const signature = await stranger.signMessage({ message });
		const rpcError = new Error("test RPC unavailable");
		mocks.publicChain.mockReturnValue({
			config: { chainId: 31337 },
			publicClient: createPublicClient({
				chain: foundry,
				transport: custom(
					{
						request: async () => {
							throw rpcError;
						},
					},
					{ retryCount: 0 },
				),
			}),
		});
		await expect(
			walletLogin(signer.address, message, signature),
		).rejects.toThrow("test RPC unavailable");
		expect(rowFor(message).consumed).toBe(false);
		expect(mocks.session.save).not.toHaveBeenCalled();
		mocks.publicChain.mockReturnValue({
			config: { chainId: 31337 },
			publicClient: createPublicClient({
				chain: foundry,
				transport: custom(provider, { retryCount: 0 }),
			}),
		});
		await walletLogin(
			signer.address,
			message,
			await signer.signMessage({ message }),
		);
		expect(mocks.session.save).toHaveBeenCalledOnce();
	});

	it("verifies ERC-1271 on the local EVM with a signature longer than the old limit", async () => {
		const { message } = await walletChallenge(contract);
		// Runtime checks the SIWE digest (calldata offset 4); a matching digest
		// returns ERC-1271 magic bytes, otherwise it reverts. No real chain writes.
		const runtime: Hex = `0x6004357f${hashMessage(message).slice(2)}14602d5760006000fd5b631626ba7e60e01b60005260206000f3`;
		await provider.request({
			method: "evm_setAccountCode",
			params: [contract, runtime],
		});
		const signature = `0x${"ab".repeat(600)}`;
		const user = await walletLogin(contract, message, signature);
		expect(user.address).toBe(contract);
		expect(mocks.session.save).toHaveBeenCalledOnce();
		const next = await walletChallenge(contract);
		await expect(
			walletLogin(contract, next.message, signature),
		).rejects.toMatchObject({
			code: "invalid_signature",
			status: 401,
		});
		expect(rowFor(next.message).consumed).toBe(false);
	});
});
