import { ProxyAgent } from "undici";
import { type GatewayProxy, proxyInput } from "~/shared/gateway-config";

/** A resource-scoped dispatcher; never changes the process-wide proxy or retries. */
export async function withGatewayTransport<T>(
	proxy: GatewayProxy | undefined,
	action: (fetcher: typeof fetch) => Promise<T>,
): Promise<T> {
	if (!proxy) return action(fetch);
	// Validate saved configurations too, before constructing an authentication header.
	const config = proxyInput.parse(proxy);
	const dispatcher = new ProxyAgent({
		uri: config.url,
		proxyTunnel: true,
		...(config.username
			? {
					token: `Basic ${Buffer.from(`${config.username}:${config.password ?? ""}`).toString("base64")}`,
				}
			: {}),
	});
	const fetcher: typeof fetch = (input, init) => {
		const options = { ...init, dispatcher, redirect: "error" as const };
		return fetch(input, options);
	};
	try {
		return await action(fetcher);
	} finally {
		await dispatcher.close();
	}
}
