import { ProxyAgent, fetch as proxyFetch } from "undici";
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
	const fetcher: typeof fetch = async (input, init) => {
		// Node 24's native fetch and Undici 8 use different dispatcher protocols.
		// Normalize the bounded JSON request across their Request/Response classes.
		const options = { ...init, redirect: "error" as const, duplex: "half" };
		const request = new Request(input, options);
		const response = await proxyFetch(request.url, {
			dispatcher,
			method: request.method,
			headers: Array.from(request.headers.entries()),
			body: request.body ? await request.arrayBuffer() : undefined,
			signal: request.signal,
			redirect: "error",
		});
		const reader = response.body?.getReader();
		const body = reader
			? new ReadableStream<Uint8Array>({
					async pull(controller) {
						const chunk = await reader.read();
						if (chunk.done) controller.close();
						else controller.enqueue(chunk.value);
					},
					cancel(reason) {
						return reader.cancel(reason);
					},
				})
			: null;
		return new Response(body, {
			status: response.status,
			statusText: response.statusText,
			headers: Array.from(response.headers.entries()),
		});
	};
	try {
		return await action(fetcher);
	} finally {
		await dispatcher.close();
	}
}
