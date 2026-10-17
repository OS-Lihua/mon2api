import "server-only";
import { randomBytes } from "node:crypto";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { getAddress, type Hex, verifyMessage } from "viem";
import { z } from "zod";
import { db } from "~/server/db";
import type { Viewer } from "~/shared/mon2api";
import { demoAccount } from "./chain";
import { demoEnabled, sessionPassword } from "./runtime";

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
	const normalized = getAddress(address).toLowerCase();
	const origin = process.env.APP_ORIGIN || "http://localhost:3000";
	const message = `${new URL(origin).host} requests a mon2api sign-in.\nWallet: ${normalized}\nURI: ${origin}\nNonce: ${randomBytes(24).toString("hex")}\nIssued: ${new Date().toISOString()}\nThis signature does not authorize token transfers.`;
	await db.walletNonce.create({
		data: {
			address: normalized,
			message,
			expiresAt: new Date(Date.now() + 300_000),
		},
	});
	return { message };
}
export async function walletLogin(
	address: string,
	message: string,
	signature: string,
) {
	const normalized = getAddress(address).toLowerCase();
	const challenge = await db.walletNonce.findUnique({ where: { message } });
	if (
		!challenge ||
		challenge.address !== normalized ||
		challenge.consumed ||
		challenge.expiresAt.getTime() <= Date.now() ||
		!/^0x[\da-fA-F]+$/.test(signature)
	)
		throw new AppError("invalid_challenge", "登录挑战已失效。", 401);
	const valid = await verifyMessage({
		address: getAddress(address),
		message,
		signature: signature as Hex,
	});
	if (!valid) throw new AppError("invalid_signature", "钱包签名无效。", 401);
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
