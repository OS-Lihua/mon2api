import "server-only";

import { PostHog } from "posthog-node";

import { env } from "~/env";
import { logger } from "./logger";

const posthogKey = env.NEXT_PUBLIC_POSTHOG_KEY;
const posthog = posthogKey?.trim()
	? new PostHog(posthogKey, { host: env.NEXT_PUBLIC_POSTHOG_HOST })
	: null;

export function captureServerEvent(
	distinctId: string,
	event: string,
	properties?: Record<string, unknown>,
) {
	if (posthog === null) {
		logger.debug({ event, distinctId, properties }, "PostHog disabled");
		return;
	}

	posthog.capture({
		distinctId,
		event,
		properties,
	});
}

export async function shutdownAnalytics() {
	await posthog?.shutdown();
}
