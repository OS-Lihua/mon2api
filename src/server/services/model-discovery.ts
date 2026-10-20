import { z } from "zod";
import { gatewayApiBase } from "../../shared/gateway-url";
import { discoveredModel, modelCatalog } from "../../shared/model-catalog";

/** Only the caller's fixed destination receives its key. Never follow redirects. */
export async function discoverModels(
	baseUrl: string,
	apiKey: string,
	fetcher: typeof fetch = fetch,
) {
	const base = gatewayApiBase(baseUrl);
	const response = await fetcher(`${base}/models`, {
		headers: { Authorization: `Bearer ${apiKey}` },
		redirect: "error",
		signal: AbortSignal.timeout(8000),
	});
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`读取模型列表失败（HTTP ${response.status}）。`);
	}
	const reader = response.body?.getReader();
	if (!reader) throw new Error("网关没有返回模型列表。");
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			bytes += part.value.byteLength;
			if (bytes > 512 * 1024) throw new Error("网关模型列表超过 512 KiB。");
			chunks.push(part.value);
		}
	} finally {
		await reader.cancel();
	}
	const body = z
		.object({ data: z.array(z.object({ id: discoveredModel })).max(500) })
		.parse(JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))));
	const models = modelCatalog.parse([
		...new Set(body.data.map((model) => model.id)),
	]);
	if (!models.length)
		throw new Error("网关没有可用模型，请先在网关配置供应商。");
	return models;
}
