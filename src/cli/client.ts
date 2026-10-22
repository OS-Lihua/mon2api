import type { Hex } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import {
	createSiweMessage,
	parseSiweMessage,
	validateSiweMessage,
} from "viem/siwe";
import type { z } from "zod";
import { z as schema } from "zod";
import { serviceUrl } from "~/connector/client";
import {
	networkResponse,
	viewerResponse,
} from "~/server/services/commerce.schema";
import { CliError } from "./protocol";
import type { LoginSession } from "./storage";

export const privateKeyInput = schema.custom<Hex>(
	(value) => typeof value === "string" && /^0x[\da-fA-F]{64}$/.test(value),
	"钱包私钥格式无效；请由用户本人重新输入。",
);
export function walletAddress(privateKey: Hex) {
	try {
		return privateKeyToAccount(privateKey).address;
	} catch {
		throw new CliError(
			"invalid_wallet_key",
			"钱包私钥无效；未保存。请用户本人检查，不要向 AI 提供私钥。",
			2,
		);
	}
}
const statement =
	"Sign in to Token2API. This signature does not authorize token transfers.";
export function validateLoginMessage(
	message: string,
	address: string,
	platform: string,
	chainId: number,
) {
	const parsed = parseSiweMessage(message);
	const now = new Date();
	if (
		!validateSiweMessage({
			address: privateKeyAddress(address),
			domain: new URL(platform).host,
			message: parsed,
			time: now,
		}) ||
		parsed.uri !== platform ||
		parsed.chainId !== chainId ||
		parsed.version !== "1" ||
		parsed.statement !== statement ||
		!parsed.nonce ||
		!/^[\da-f]{48}$/.test(parsed.nonce) ||
		!parsed.issuedAt ||
		!parsed.expirationTime ||
		parsed.issuedAt.getTime() > now.getTime() ||
		parsed.expirationTime.getTime() - parsed.issuedAt.getTime() !== 300_000 ||
		createSiweMessage({
			address: privateKeyAddress(address),
			domain: new URL(platform).host,
			uri: platform,
			chainId,
			version: "1",
			nonce: parsed.nonce,
			issuedAt: parsed.issuedAt,
			expirationTime: parsed.expirationTime,
			statement,
		}) !== message
	)
		throw new CliError(
			"unsafe_login_message",
			"拒绝签署不符合本平台登录约定的消息。请核对平台地址；不要向 AI 提供私钥。",
			4,
		);
}
function privateKeyAddress(value: string): `0x${string}` {
	return schema
		.custom<`0x${string}`>(
			(address) =>
				typeof address === "string" && /^0x[\da-fA-F]{40}$/.test(address),
		)
		.parse(value);
}

export class ManagementClient {
	readonly platform: string;
	constructor(
		platform: string,
		private readonly session?: LoginSession,
		private readonly fetcher: typeof fetch = fetch,
	) {
		this.platform = serviceUrl(platform);
		if (session && session.platform !== this.platform)
			throw new CliError(
				"platform_mismatch",
				"管理会话不属于指定平台，拒绝发送凭证。",
				3,
			);
	}
	async request<T extends z.ZodTypeAny>(
		method: "GET" | "POST",
		route: string,
		output: T,
		body?: unknown,
	): Promise<{ data: z.infer<T>; cookie?: string }> {
		if (
			!/^\/[a-zA-Z0-9/_?=&%.-]+$/.test(route) ||
			route.includes("..") ||
			route.includes("//")
		)
			throw new CliError("invalid_route", "接口路径无效。", 2);
		try {
			const response = await this.fetcher(`${this.platform}/api/v1${route}`, {
				method,
				redirect: "error",
				signal: AbortSignal.timeout(15_000),
				headers: {
					"Content-Type": "application/json",
					...(this.session ? { Cookie: this.session.cookie } : {}),
				},
				...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			});
			if (!response.ok) {
				await response.body?.cancel();
				const status = response.status;
				if (method === "POST" && status >= 500)
					throw new CliError(
						"outcome_unknown",
						"平台未确认写入结果；操作可能已成功。先查询资源，不要自动重复创建或轮换凭证。",
						7,
						{ method, route },
					);
				throw new CliError(
					status === 401
						? "authentication_required"
						: status === 403
							? "forbidden"
							: status === 409
								? "conflict"
								: "http_error",
					`平台返回 HTTP ${status}。未打印响应内容，以免泄露凭证。`,
					status === 401
						? 3
						: status === 403
							? 4
							: status === 409
								? 5
								: status === 429 || status >= 500
									? 7
									: 2,
					{ status, method, route },
				);
			}
			const reader = response.body?.getReader();
			if (!reader) throw new Error("Empty response");
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				for (;;) {
					const part = await reader.read();
					if (part.done) break;
					size += part.value.length;
					if (size > 1_048_576) throw new Error("Oversized response");
					chunks.push(part.value);
				}
			} finally {
				await reader.cancel();
			}
			const data = output.parse(
				JSON.parse(Buffer.concat(chunks).toString("utf8")),
			);
			const cookie = response.headers
				.getSetCookie()
				.find((value) => value.startsWith("token2api_session="))
				?.split(";")[0];
			return { data, ...(cookie ? { cookie } : {}) };
		} catch (error) {
			if (error instanceof CliError) throw error;
			throw new CliError(
				method === "POST" ? "outcome_unknown" : "unavailable",
				method === "POST"
					? "未能确认写入结果；操作可能已成功。先查询资源，不要自动重试。"
					: "无法读取平台响应，请检查地址、网络和服务状态。",
				7,
				{ method, route },
			);
		}
	}
	async login(
		privateKey: Hex,
		chainId: number,
	): Promise<{
		session: LoginSession;
		viewer: z.infer<typeof viewerResponse>;
	}> {
		const account = privateKeyToAccount(privateKey);
		const local =
			chainId === 31337 &&
			["localhost", "127.0.0.1", "[::1]"].includes(
				new URL(this.platform).hostname,
			);
		if (
			!local &&
			Array.from(
				{ length: 10 },
				(_, addressIndex) =>
					mnemonicToAccount(
						"test test test test test test test test test test test junk",
						{ addressIndex },
					).address,
			).includes(account.address)
		)
			throw new CliError(
				"demo_key_restricted",
				"公开测试钱包只能连接回环链 31337；拒绝用于远程平台或真实网络。",
				4,
			);
		const { data: challenge } = await this.request(
			"POST",
			"/auth/challenge",
			schema.object({ message: schema.string().max(1000) }).strict(),
			{ address: account.address },
		);
		validateLoginMessage(
			challenge.message,
			account.address,
			this.platform,
			chainId,
		);
		const signature = await account.signMessage({ message: challenge.message });
		const result = await this.request("POST", "/auth/login", viewerResponse, {
			address: account.address,
			message: challenge.message,
			signature,
		});
		if (
			!result.cookie ||
			result.data.address.toLowerCase() !== account.address.toLowerCase()
		)
			throw new CliError(
				"invalid_session",
				"平台没有返回与签名钱包一致的登录会话。",
				3,
			);
		return {
			viewer: result.data,
			session: {
				platform: this.platform,
				address: account.address,
				cookie: result.cookie,
				expiresAt: Date.now() + 8 * 3600_000,
			},
		};
	}
	network() {
		return this.request("GET", "/network", networkResponse);
	}
}
