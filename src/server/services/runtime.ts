import "server-only";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { db } from "~/server/db";

export const chainConfigSchema = z.object({
	mode: z.enum(["local", "monad-testnet"]),
	chainId: z.number().int(),
	rpcUrl: z.string().url(),
	token: z.string().regex(/^0x[\da-fA-F]{40}$/),
	escrow: z.string().regex(/^0x[\da-fA-F]{40}$/),
	meter: z.string().regex(/^0x[\da-fA-F]{40}$/),
	treasury: z.string().regex(/^0x[\da-fA-F]{40}$/),
	deploymentBlock: z.string().regex(/^\d+$/),
});
export type ChainConfig = z.infer<typeof chainConfigSchema>;
export const runtimeDirectory = () =>
	path.resolve(
		/* turbopackIgnore: true */ process.env.MON2API_DATA_DIR || ".runtime",
	);
export function chainConfig(): ChainConfig {
	const value = chainConfigSchema.parse(
		JSON.parse(
			process.env.CHAIN_CONFIG_JSON ||
				fs.readFileSync(path.join(runtimeDirectory(), "chain.json"), "utf8"),
		),
	);
	if (
		value.mode === "local" &&
		(value.chainId !== 31337 ||
			!["127.0.0.1", "localhost"].includes(new URL(value.rpcUrl).hostname))
	)
		throw new Error("Local chain configuration must use loopback chain 31337.");
	if (value.mode === "monad-testnet" && value.chainId !== 10143)
		throw new Error("Only Monad testnet is supported.");
	return value;
}
export function sessionPassword(): string {
	if (process.env.SESSION_PASSWORD && process.env.SESSION_PASSWORD.length >= 32)
		return process.env.SESSION_PASSWORD;
	if (
		process.env.MON2API_MODE === "monad-testnet" ||
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
	process.env.MON2API_MODE !== "monad-testnet";
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
		},
	});
	if (
		binding.chainId !== config.chainId ||
		binding.escrow !== config.escrow.toLowerCase() ||
		binding.token !== config.token.toLowerCase()
	)
		throw new Error(
			"Deployment mismatch: use a separate DATABASE_URL and MON2API_DATA_DIR for each deployment.",
		);
}
