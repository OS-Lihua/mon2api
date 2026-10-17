import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		DATABASE_URL: z.string().url(),
		MON2API_MODE: z.enum(["local", "monad-testnet"]).default("local"),
		ALLOW_DEMO: z.enum(["true", "false"]).default("false"),
		APP_ORIGIN: z.string().url().default("http://localhost:3000"),
		SESSION_PASSWORD: z.string().min(32).optional(),
		UPSTREAM_ALLOWED_ORIGINS: z.string().default(""),
		METER_PRIVATE_KEY: z.string().optional(),
		DEPLOYER_PRIVATE_KEY: z.string().optional(),
		TREASURY_ADDRESS: z.string().optional(),
		MON2API_DATA_DIR: z.string().optional(),
		CHAIN_CONFIG_JSON: z.string().optional(),
		TESTNET_TOKEN_ADDRESS: z.string().optional(),
		APP_ENV: z.string().optional(),
		ALLOWED_ORIGINS: z.string().default(""),
		LOG_LEVEL: z
			.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
			.default("info"),
		RATE_LIMIT_ENABLED: z
			.enum(["true", "false"])
			.default("true")
			.transform((value) => value === "true"),
		RATE_LIMIT_REQUESTS: z.coerce.number().int().positive().default(60),
		RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
		RATE_LIMIT_MAX_BUCKETS: z.coerce.number().int().positive().default(10000),
		RATE_LIMIT_IP_HEADER: z
			.enum(["none", "x-forwarded-for", "x-real-ip", "cf-connecting-ip"])
			.default("none"),
		SENTRY_DSN: z.string().url().optional(),
		SENTRY_ORG: z.string().optional(),
		SENTRY_PROJECT: z.string().optional(),
		SENTRY_AUTH_TOKEN: z.string().optional(),
		SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
		UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
		UPSTASH_REDIS_REST_URL: z.string().url().optional(),
		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
	},

	/**
	 * Specify your client-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars. To expose them to the client, prefix them with
	 * `NEXT_PUBLIC_`.
	 */
	client: {
		NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z
			.string()
			.regex(/^[a-fA-F0-9]{32}$/)
			.optional(),
		NEXT_PUBLIC_APP_ENV: z.string().optional(),
		NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
		NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: z.coerce
			.number()
			.min(0)
			.max(1)
			.default(0.1),
		NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
		NEXT_PUBLIC_POSTHOG_HOST: z
			.string()
			.url()
			.default("https://us.i.posthog.com"),
	},

	/**
	 * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
	 * middlewares) or client-side so we need to destruct manually.
	 */
	runtimeEnv: {
		NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
			process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
		DATABASE_URL: process.env.DATABASE_URL,
		MON2API_MODE: process.env.MON2API_MODE,
		ALLOW_DEMO: process.env.ALLOW_DEMO,
		APP_ORIGIN: process.env.APP_ORIGIN,
		SESSION_PASSWORD: process.env.SESSION_PASSWORD,
		UPSTREAM_ALLOWED_ORIGINS: process.env.UPSTREAM_ALLOWED_ORIGINS,
		METER_PRIVATE_KEY: process.env.METER_PRIVATE_KEY,
		DEPLOYER_PRIVATE_KEY: process.env.DEPLOYER_PRIVATE_KEY,
		TREASURY_ADDRESS: process.env.TREASURY_ADDRESS,
		MON2API_DATA_DIR: process.env.MON2API_DATA_DIR,
		CHAIN_CONFIG_JSON: process.env.CHAIN_CONFIG_JSON,
		TESTNET_TOKEN_ADDRESS: process.env.TESTNET_TOKEN_ADDRESS,
		APP_ENV: process.env.APP_ENV,
		ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
		LOG_LEVEL: process.env.LOG_LEVEL,
		RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
		RATE_LIMIT_REQUESTS: process.env.RATE_LIMIT_REQUESTS,
		RATE_LIMIT_WINDOW_SECONDS: process.env.RATE_LIMIT_WINDOW_SECONDS,
		RATE_LIMIT_MAX_BUCKETS: process.env.RATE_LIMIT_MAX_BUCKETS,
		RATE_LIMIT_IP_HEADER: process.env.RATE_LIMIT_IP_HEADER,
		SENTRY_DSN: process.env.SENTRY_DSN,
		SENTRY_ORG: process.env.SENTRY_ORG,
		SENTRY_PROJECT: process.env.SENTRY_PROJECT,
		SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
		SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE,
		UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
		UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
		NODE_ENV: process.env.NODE_ENV,
		NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
		NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
		NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE:
			process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
		NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
		NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
	},
	/**
	 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
	 * useful for Docker builds.
	 */
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	/**
	 * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
	 * `SOME_VAR=''` will throw an error.
	 */
	emptyStringAsUndefined: true,
});
