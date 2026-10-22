import { z } from "zod";
import { gatewayApiBase } from "./gateway-url";

export function proxyAuthenticationAllowed(raw: string): boolean {
	try {
		const url = new URL(raw);
		return (
			url.protocol === "https:" ||
			(url.protocol === "http:" &&
				["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
		);
	} catch {
		return false;
	}
}

export function endpointUrl(raw: string, kind: "GATEWAY" | "PROXY"): string {
	const url = new URL(raw.trim());
	if (kind === "GATEWAY") {
		const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		if (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
			throw new Error("远程网关必须使用 HTTPS；本机回环地址可使用 HTTP。");
		return gatewayApiBase(raw.trim());
	}
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/"
	)
		throw new Error("代理地址须为 HTTP/HTTPS 地址，不含路径、凭证或查询参数。");
	return url.origin;
}

export const proxyInput = z
	.object({
		url: z
			.string()
			.trim()
			.url()
			.max(2048)
			.transform((value, ctx) => {
				try {
					return endpointUrl(value, "PROXY");
				} catch {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: "代理地址须为 HTTP/HTTPS 地址，不含路径、凭证或查询参数。",
					});
					return z.NEVER;
				}
			}),
		username: z
			.string()
			.min(1)
			.max(512)
			.regex(/^[^:\r\n]+$/)
			.optional(),
		password: z.string().max(1024).optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.password !== undefined && !value.username)
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "填写代理密码时也须填写用户名。",
			});
		if (value.username && !proxyAuthenticationAllowed(value.url))
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["url"],
				message: "带认证的远程代理必须使用 HTTPS；HTTP 认证仅允许回环地址。",
			});
	})
	.describe(
		"HTTP/HTTPS proxy origin with optional authentication. Authenticated remote proxies require HTTPS; HTTP authentication is allowed only for localhost, 127.0.0.1 or [::1].",
	);
export type GatewayProxy = z.infer<typeof proxyInput>;

export const endpointPolicyInput = z
	.object({
		kind: z.enum(["GATEWAY", "PROXY"]),
		url: z.string().trim().url().max(2048),
		name: z.string().trim().min(1).max(64),
		note: z.string().trim().max(300).default(""),
	})
	.strict()
	.transform((value, ctx) => {
		try {
			return { ...value, url: endpointUrl(value.url, value.kind) };
		} catch (error) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: error instanceof Error ? error.message : "地址无效。",
			});
			return z.NEVER;
		}
	});
export const endpointStatusInput = z
	.object({ id: z.string().cuid(), enabled: z.boolean() })
	.strict();
