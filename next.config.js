/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import { withSentryConfig } from "@sentry/nextjs/config";
import {
	arbitrum,
	avalanche,
	base,
	bsc,
	mainnet,
	optimism,
	polygon,
} from "viem/chains";

/** @type {import("next").NextConfig} */
const config = {
	reactCompiler: true,
	experimental: {
		turbopackRustReactCompiler: true,
	},
	async headers() {
		// Only enable relay and verification origins when mobile wallets are configured.
		const walletSources = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
			? " https://relay.walletconnect.com wss://relay.walletconnect.com https://relay.walletconnect.org wss://relay.walletconnect.org https://rpc.walletconnect.com https://rpc.walletconnect.org https://pulse.walletconnect.com https://pulse.walletconnect.org https://verify.walletconnect.com https://verify.walletconnect.org https://*.metamask.io wss://*.metamask.io"
			: "";
		const walletFrames = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
			? " https://verify.walletconnect.com https://verify.walletconnect.org"
			: "";
		const settlementSources = `${[
			...new Set(
				[mainnet, base, arbitrum, optimism, bsc, polygon, avalanche].flatMap(
					(chain) =>
						chain.rpcUrls.default.http.map((rpc) => new URL(rpc).origin),
				),
			),
		].join(" ")} https://rpc.mainnet.chain.robinhood.com`;
		return [
			{
				source: "/(.*)",
				headers: [
					{
						key: "Content-Security-Policy",
						value: [
							"default-src 'self'",
							"base-uri 'self'",
							"frame-ancestors 'none'",
							`frame-src 'self'${walletFrames}`,
							"object-src 'none'",
							"img-src 'self' data: blob: https:",
							"font-src 'self' data:",
							"style-src 'self' 'unsafe-inline'",
							"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
							`connect-src 'self' http://127.0.0.1:8545 http://localhost:8545 ${settlementSources} https://*.sentry.io https://*.posthog.com https://us.i.posthog.com${walletSources}`,
							"form-action 'self'",
							"upgrade-insecure-requests",
						].join("; "),
					},
					{
						key: "Cross-Origin-Opener-Policy",
						value: "same-origin",
					},
					{
						key: "Cross-Origin-Resource-Policy",
						value: "same-origin",
					},
					{
						key: "Permissions-Policy",
						value: "camera=(), microphone=(), geolocation=(), payment=()",
					},
					{
						key: "Referrer-Policy",
						value: "strict-origin-when-cross-origin",
					},
					{
						key: "X-Content-Type-Options",
						value: "nosniff",
					},
					{
						key: "X-Frame-Options",
						value: "DENY",
					},
				],
			},
		];
	},
	output: "standalone",
	outputFileTracingIncludes: {
		// The Vercel launcher loads Next's Node environment before route handlers.
		// Include the framework files that its minimal runtime trace currently misses.
		"/*": ["./node_modules/next/dist/lib/framework/*.js"],
	},
	outputFileTracingExcludes: {
		"/*": [
			"./.runtime/**",
			"./.runtime-*/**",
			"./work/**",
			"./.env*",
			"./contracts/artifacts/**",
		],
	},
};

export default withSentryConfig(config, {
	org: process.env.SENTRY_ORG,
	project: process.env.SENTRY_PROJECT,
	silent: !process.env.CI,
	widenClientFileUpload: true,
	webpack: {
		automaticVercelMonitors: true,
		treeshake: {
			removeDebugLogging: true,
		},
	},
});
