import "server-only";
import { sealData, unsealData } from "iron-session";
import { db } from "~/server/db";
import {
	endpointUrl,
	type GatewayProxy,
	proxyInput,
} from "~/shared/gateway-config";
import { AppError } from "./auth";
import { sessionPassword } from "./runtime";

/** Exact, normalized endpoints. A proxy never expands the approved destinations. */
export async function requireGatewayAccess(
	baseUrl: string,
	proxyUrl?: string | null,
) {
	let base: string;
	let proxy: string | undefined;
	try {
		base = endpointUrl(baseUrl, "GATEWAY");
		proxy = proxyUrl ? endpointUrl(proxyUrl, "PROXY") : undefined;
	} catch {
		throw new AppError(
			"connector_not_allowed",
			"网关或代理地址格式无效。",
			400,
		);
	}
	const required = [
		{ kind: "GATEWAY", url: base },
		...(proxy ? [{ kind: "PROXY", url: proxy }] : []),
	];
	const approved = await db.endpointPolicy.findMany({
		where: { enabled: true, OR: required },
		select: { kind: true, url: true },
	});
	if (
		!required.every((entry) =>
			approved.some(
				(allowed) => allowed.kind === entry.kind && allowed.url === entry.url,
			),
		)
	)
		throw new AppError(
			"connector_not_allowed",
			"网关或代理地址尚未获准，请联系管理员加入白名单。",
			403,
		);
	return base;
}

export async function sealProxy(proxy?: GatewayProxy) {
	return {
		proxyUrl: proxy?.url ?? null,
		proxySecret: proxy?.username
			? await sealData(
					{ username: proxy.username, password: proxy.password ?? "" },
					{ password: sessionPassword(), ttl: 0 },
				)
			: null,
	};
}

export async function readProxy(listing: {
	proxyUrl: string | null;
	proxySecret: string | null;
}): Promise<GatewayProxy | undefined> {
	if (!listing.proxyUrl) return undefined;
	const credentials = listing.proxySecret
		? await unsealData<unknown>(listing.proxySecret, {
				password: sessionPassword(),
				ttl: 0,
			})
		: {};
	if (
		typeof credentials !== "object" ||
		credentials === null ||
		Array.isArray(credentials)
	)
		throw new AppError(
			"connector_unconfigured",
			"代理凭证不可用，请重新接入资源。",
			503,
		);
	if (listing.proxySecret && !("username" in credentials))
		throw new AppError(
			"connector_unconfigured",
			"代理凭证不可用，请重新接入资源。",
			503,
		);
	const parsed = proxyInput.safeParse({
		...credentials,
		url: listing.proxyUrl,
	});
	if (!parsed.success)
		throw new AppError(
			"connector_unconfigured",
			"代理配置不可用。带认证的远程代理须使用 HTTPS，请重新接入资源。",
			503,
		);
	return parsed.data;
}
