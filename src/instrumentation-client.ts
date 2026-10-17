import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";

if (process.env.NEXT_PUBLIC_SENTRY_DSN !== undefined) {
	Sentry.init({
		dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
		environment: process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV,
		tracesSampleRate: Number(
			process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1",
		),
	});
}

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
if (posthogKey?.trim()) {
	posthog.init(posthogKey, {
		api_host:
			process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
		capture_pageview: true,
		defaults: "2025-05-24",
	});
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
