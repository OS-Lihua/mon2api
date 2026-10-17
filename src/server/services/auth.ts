import "server-only";
import { randomBytes } from "node:crypto";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import {
	BaseError,
	ExecutionRevertedError,
	getAddress,
	type Hex,
	publicActions,
} from "viem";
import {
	createSiweMessage,
	parseSiweMessage,
	validateSiweMessage,
} from "viem/siwe";
import { z } from "zod";
import { db } from "~/server/db";
import type { Viewer } from "~/shared/mon2api";
import { demoAccount, clients as publicChain } from "./chain";
import { walletSignatureSchema } from "./mon2api.schema";
import { chainConfig, demoEnabled, sessionPassword } from "./runtime";

export { walletSignatureSchema } from "./mon2api.schema";

const challengeLifetimeMs = 300_000;
const signInStatement =
	"Sign in to mon2api. This signature does not authorize token transfers.";
function walletAddress(address: string) {
	try {
		return getAddress(address);
	} catch {
		throw new AppError("invalid_address", "钱包地址无效。", 400);
	}
}
function signInOrigin() {
	return new URL(process.env.APP_ORIGIN || "http://localhost:3000").origin;
}

export class AppError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly status = 400,
	) {
		super(message);
		this.name = "AppError";
	}
}
const viewerSchema = z.object({
	address: z.string().regex(/^0x[\da-f]{40}$/),
	name: z.string().max(100),
	demo: z.boolean(),
});
async function authSession() {
	return getIronSession<{ viewer?: Viewer }>(await cookies(), {
		cookieName: "mon2api_session",
		password: sessionPassword(),
		ttl: 8 * 3600,
		cookieOptions: {
			httpOnly: true,
			sameSite: "strict",
			secure: (process.env.APP_ORIGIN || "").startsWith("https://"),
			path: "/",
		},
	});
}
export async function viewer(): Promise<Viewer | null> {
	const session = await authSession();
	const parsed = viewerSchema.safeParse(session.viewer);
	if (!parsed.success || (parsed.data.demo && !demoEnabled())) return null;
	return parsed.data;
}
export async function requireViewer() {
	const user = await viewer();
	if (!user)
		throw new AppError("unauthorized", "请先连接钱包或进入本地演示。", 401);
	return user;
}
export async function demoLogin(role: "consumer" | "provider") {
	if (!demoEnabled())
		throw new AppError("demo_disabled", "演示登录未启用。", 403);
	const user = {
		address: demoAccount(role === "consumer" ? 0 : 1).address.toLowerCase(),
		name: role === "consumer" ? "Demo Developer" : "Demo Provider",
		demo: true,
	};
	const session = await authSession();
	session.viewer = user;
	await session.save();
	return user;
}
export async function logout() {
	(await authSession()).destroy();
}
export async function walletChallenge(address: string) {
	const signer = walletAddress(address);
	const origin = signInOrigin();
	const issuedAt = new Date();
	const expiresAt = new Date(issuedAt.getTime() + challengeLifetimeMs);
	const message = createSiweMessage({
		address: signer,
		domain: new URL(origin).host,
		uri: origin,
		chainId: chainConfig().chainId,
		version: "1",
		nonce: randomBytes(24).toString("hex"),
		issuedAt,
		expirationTime: expiresAt,
		statement: signInStatement,
	});
	await db.walletNonce.create({
		data: { address: signer.toLowerCase(), message, expiresAt },
	});
	return { message };
}
export async function walletLogin(
	address: string,
	message: string,
	signature: string,
) {
	const signer = walletAddress(address);
	const normalized = signer.toLowerCase();
	if (!walletSignatureSchema.safeParse(signature).success)
		throw new AppError("invalid_signature", "钱包签名格式无效。", 400);
	const challenge = await db.walletNonce.findUnique({ where: { message } });
	const now = new Date();
	if (
		!challenge ||
		challenge.message !== message ||
		challenge.address !== normalized ||
		challenge.consumed ||
		challenge.expiresAt.getTime() <= now.getTime()
	)
		throw new AppError("invalid_challenge", "登录挑战已失效。", 401);
	const origin = signInOrigin();
	const domain = new URL(origin).host;
	const parsed = parseSiweMessage(message);
	const { config, publicClient } = publicChain();
	if (
		!validateSiweMessage({
			address: signer,
			domain,
			message: parsed,
			time: now,
		}) ||
		parsed.uri !== origin ||
		parsed.chainId !== config.chainId ||
		parsed.version !== "1" ||
		!parsed.nonce ||
		!/^[\da-f]{48}$/.test(parsed.nonce) ||
		!parsed.issuedAt ||
		!Number.isFinite(parsed.issuedAt.getTime()) ||
		parsed.issuedAt.getTime() > now.getTime() ||
		!parsed.expirationTime ||
		parsed.expirationTime.getTime() !== challenge.expiresAt.getTime() ||
		parsed.expirationTime.getTime() - parsed.issuedAt.getTime() !==
			challengeLifetimeMs ||
		createSiweMessage({
			address: signer,
			domain,
			uri: origin,
			chainId: config.chainId,
			version: "1",
			nonce: parsed.nonce,
			issuedAt: parsed.issuedAt,
			expirationTime: parsed.expirationTime,
			statement: signInStatement,
		}) !== message
	)
		throw new AppError("invalid_challenge", "登录挑战已失效。", 401);

	// viem treats CallExecutionError as a rejected contract signature, including
	// transport failures. Record non-revert failures before that conversion.
	let rpcFailure: unknown;
	const verificationClient = publicClient
		.extend(() => ({
			call: async (...args: Parameters<typeof publicClient.call>) => {
				try {
					return await publicClient.call(...args);
				} catch (error) {
					const reverted =
						error instanceof BaseError &&
						(error.walk(
							(cause) => cause instanceof ExecutionRevertedError,
						) instanceof ExecutionRevertedError ||
							// Ganache reports reverts with -32000, not the usual code 3.
							/^VM Exception while processing transaction: revert\b/.test(
								error.details || "",
							));
					if (!reverted) rpcFailure = error;
					throw error;
				}
			},
		}))
		// Rebind the action so its nested calls use the guarded client.
		.extend((client) => ({
			verifySiweMessage: publicActions(client).verifySiweMessage,
		}));
	const valid = await verificationClient.verifySiweMessage({
		address: signer,
		domain,
		nonce: parsed.nonce,
		time: now,
		message,
		signature: signature as Hex,
	});
	if (!valid) {
		if (rpcFailure) throw rpcFailure;
		throw new AppError("invalid_signature", "钱包签名无效。", 401);
	}
	const consumed = await db.walletNonce.updateMany({
		where: { id: challenge.id, consumed: false, expiresAt: { gt: new Date() } },
		data: { consumed: true },
	});
	if (consumed.count !== 1)
		throw new AppError("invalid_challenge", "登录挑战已使用。", 401);
	const user = {
		address: normalized,
		name: `${normalized.slice(0, 6)}…${normalized.slice(-4)}`,
		demo: false,
	};
	const session = await authSession();
	session.viewer = user;
	await session.save();
	return user;
}
export function assertSameOrigin(headers: Headers) {
	const origin = headers.get("origin");
	const allowed = process.env.APP_ORIGIN || "http://localhost:3000";
	if (origin && origin !== allowed)
		throw new AppError("forbidden", "请求来源不匹配。", 403);
}
