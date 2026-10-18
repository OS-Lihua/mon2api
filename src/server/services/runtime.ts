import "server-only";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "~/server/db";
import { DEFAULT_NETWORK } from "~/shared/network";
import { assetOf, decimalsOf } from "~/shared/settlement-asset";

import {
	type ChainConfig,
	chainConfigSchema,
	validateChainConfig,
} from "~/shared/settlement-config";

export type { ChainConfig };
export const runtimeDirectory = () =>
	path.resolve(
		/* turbopackIgnore: true */ process.env.MON2API_DATA_DIR ||
			(process.env.MON2API_MODE === "local"
				? ".runtime"
				: `.runtime/evm/${process.env.SETTLEMENT_CHAIN_ID || DEFAULT_NETWORK.chainId}-${(process.env.SETTLEMENT_ASSET || "ETH").toLowerCase()}`),
	);
export function chainConfig(): ChainConfig {
	const value = chainConfigSchema.parse(
		JSON.parse(
			process.env.CHAIN_CONFIG_JSON ||
				fs.readFileSync(path.join(runtimeDirectory(), "chain.json"), "utf8"),
		),
	);
	if ((process.env.MON2API_MODE || "evm") !== value.mode)
		throw new Error(
			"MON2API_MODE does not match the active chain configuration.",
		);
	return validateChainConfig(value);
}
export function sessionPassword(): string {
	if (process.env.SESSION_PASSWORD && process.env.SESSION_PASSWORD.length >= 32)
		return process.env.SESSION_PASSWORD;
	if (
		process.env.MON2API_MODE !== "local" ||
		process.env.NODE_ENV === "production"
	)
		throw new Error("Set SESSION_PASSWORD to at least 32 random characters.");
	const file = path.join(runtimeDirectory(), "session-secret");
	fs.mkdirSync(runtimeDirectory(), { recursive: true });
	if (!fs.existsSync(file))
		fs.writeFileSync(file, randomBytes(48).toString("base64url"), {
			mode: 0o600,
			flag: "wx",
		});
	return fs.readFileSync(file, "utf8");
}
export const demoEnabled = () =>
	process.env.ALLOW_DEMO === "true" &&
	process.env.MON2API_MODE === "local" &&
	chainConfig().mode === "local";
export function validateConnectorUrl(raw: string): string {
	const url = new URL(raw);
	const origins = (process.env.UPSTREAM_ALLOWED_ORIGINS || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (
		!origins.includes(url.origin) ||
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!["", "/", "/v1", "/v1/"].includes(url.pathname)
	)
		throw new Error(
			"上游地址未列入运营者的 UPSTREAM_ALLOWED_ORIGINS，或路径不是 /v1。",
		);
	return url.toString();
}

export async function ensureChainBinding() {
	const config = chainConfig();
	const binding = await db.chainBinding.upsert({
		where: { id: "active" },
		update: {},
		create: {
			id: "active",
			chainId: config.chainId,
			escrow: config.escrow.toLowerCase(),
			token: config.token.toLowerCase(),
			asset: assetOf(config),
			tokenDecimals: decimalsOf(config),
		},
	});
	if (
		binding.chainId !== config.chainId ||
		binding.escrow !== config.escrow.toLowerCase() ||
		binding.token !== config.token.toLowerCase() ||
		(binding.asset ?? "dUSD") !== assetOf(config) ||
		binding.tokenDecimals !== decimalsOf(config)
	)
		throw new Error(
			"Deployment mismatch: use a separate DATABASE_URL and MON2API_DATA_DIR for each deployment.",
		);
}
