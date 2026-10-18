import { setTimeout as delay } from "node:timers/promises";
import type { z } from "zod";
import { discoverModels } from "../server/services/model-discovery";
import { EngineFailure, runEngine } from "../server/services/pool-engine";
import {
	type connectorJob,
	connectorOk,
	connectorPollResponse,
	connectorResult,
	connectorStatusResponse,
	connectorTokenResponse,
	type connectorUpdate,
} from "../shared/connector";

export function serviceUrl(raw: string, upstream = false) {
	const url = new URL(raw);
	const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
	if (
		(url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!(upstream ? ["/", "/v1", "/v1/"] : ["/"]).includes(url.pathname)
	)
		throw new Error(
			"地址必须为 HTTPS（回环地址可用 HTTP），且不能包含凭证或查询参数。",
		);
	return url.toString().replace(/\/$/, "");
}
class ConnectorClientError extends Error {
	constructor(readonly status: number) {
		super(`平台请求未完成（HTTP ${status}）。`);
	}
}
export class ConnectorClient {
	static async connect(platform: string, code: string) {
		const bootstrap = new ConnectorClient(platform, code);
		return (await bootstrap.call("connect", {}, connectorTokenResponse)).token;
	}
	constructor(
		readonly platform: string,
		private token: string,
		private fetcher: typeof fetch = fetch,
	) {}
	async call<T extends z.ZodTypeAny>(
		path: string,
		body: unknown,
		output: T,
		signal?: AbortSignal,
	): Promise<z.infer<T>> {
		const response = await this.fetcher(
			`${this.platform}/api/v1/connector/${path}`,
			{
				method: body === undefined ? "GET" : "POST",
				redirect: "error",
				headers: {
					Authorization: `Bearer ${this.token}`,
					"Content-Type": "application/json",
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				signal: signal
					? AbortSignal.any([signal, AbortSignal.timeout(8000)])
					: AbortSignal.timeout(8000),
			},
		);
		if (!response.ok) {
			await response.body?.cancel();
			throw new ConnectorClientError(response.status);
		}
		// Platform replies are small (24 KB input contract). Refuse an oversized/malicious reply.
		const reader = response.body?.getReader();
		if (!reader) throw new Error("平台返回空响应。");
		const chunks: Uint8Array[] = [];
		let bytes = 0;
		try {
			while (true) {
				const part = await reader.read();
				if (part.done) break;
				bytes += part.value.byteLength;
				if (bytes > 160 * 1024) throw new Error("平台响应过大。");
				chunks.push(part.value);
			}
		} finally {
			await reader.cancel();
		}
		return output.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
	}
	async status() {
		return this.call("status", undefined, connectorStatusResponse);
	}
	async run(options: {
		model?: string;
		upstream: string;
		apiKey: string;
		signal: AbortSignal;
		log: (message: string) => void;
	}) {
		let models: string[] = [];
		let catalogReadAt = 0;
		while (!options.signal.aborted) {
			try {
				if (!options.model && Date.now() - catalogReadAt > 60_000) {
					models = await discoverModels(options.upstream, options.apiKey);
					await this.call("catalog", { models }, connectorOk, options.signal);
					catalogReadAt = Date.now();
					options.log(
						`已自动读取 ${models.length} 个模型。请回到网页选择模型和报价后上架。`,
					);
				}
				const polled = await this.call(
					"poll",
					options.model ? { model: options.model } : {},
					connectorPollResponse,
					options.signal,
				);
				if (polled.job) {
					const model = options.model ?? polled.job.input.model;
					if (!options.model && !models.includes(model))
						throw new Error("任务模型不在本机目录中。");
					await this.execute(polled.job, { ...options, model });
				}
			} catch (error) {
				if (options.signal.aborted) break;
				if (
					error instanceof ConnectorClientError &&
					[401, 403, 409].includes(error.status)
				)
					throw error;
				options.log("连接暂不可用，稍后重连；已领取的任务不会重新执行。");
			}
			try {
				await delay(2000, undefined, { signal: options.signal });
			} catch {
				break;
			}
		}
		await this.call("disconnect", {}, connectorOk).catch(() => undefined);
	}
	async execute(
		job: z.infer<typeof connectorJob>,
		options: {
			model: string;
			upstream: string;
			apiKey: string;
			signal: AbortSignal;
			log: (message: string) => void;
		},
	) {
		if (job.input.model !== options.model)
			throw new Error("拒绝执行与本机配置不一致的模型。");
		const remaining = new Date(job.expiresAt).getTime() - Date.now() - 1000;
		if (remaining <= 0) return;
		const controller = new AbortController();
		const signal = AbortSignal.any([
			options.signal,
			controller.signal,
			AbortSignal.timeout(remaining),
		]);
		let text = "";
		let revision = 0;
		let stopped = false;
		const send = async (update: z.infer<typeof connectorUpdate>) => {
			// Only delivery of the same cumulative update may retry. Inference never retries.
			for (let attempt = 0; attempt < 2; attempt++) {
				try {
					await this.call("updates", update, connectorOk);
					return;
				} catch (error) {
					if (
						error instanceof ConnectorClientError &&
						[400, 401, 403, 404, 409].includes(error.status)
					)
						throw error;
					if (attempt === 1) throw error;
					await delay(500);
				}
			}
		};
		let pumping = Promise.resolve();
		const timer = setInterval(() => {
			if (stopped) return;
			stopped = true;
			pumping = send({
				jobId: job.id,
				revision: ++revision,
				event: "progress",
				text,
			})
				.catch(() => {
					controller.abort();
				})
				.finally(() => {
					stopped = false;
				});
		}, 2000);
		try {
			const result = await runEngine(
				{
					kind: "gateway",
					baseUrl: options.upstream,
					apiKey: options.apiKey,
					...job.input,
				},
				(delta) => {
					const next = text + delta;
					if (Buffer.byteLength(next, "utf8") > 65536)
						throw new Error("上游响应超出限制。");
					text = next;
				},
				signal,
			);
			clearInterval(timer);
			await pumping;
			await send({
				jobId: job.id,
				revision: ++revision,
				event: "complete",
				text,
				result: connectorResult.parse(result),
			});
			options.log(`任务 ${job.id} 已返回结果与用量。`);
		} catch (error) {
			clearInterval(timer);
			await pumping;
			await send({
				jobId: job.id,
				revision: ++revision,
				event: "failed",
				text,
				failure: {
					code:
						error instanceof EngineFailure
							? error.code
							: "upstream_unavailable",
					upstreamRequestId:
						error instanceof EngineFailure ? error.upstreamRequestId : null,
				},
			}).catch(() => undefined);
			options.log(`任务 ${job.id} 未完成，平台将保留不确定用量等待核对。`);
		} finally {
			clearInterval(timer);
			controller.abort();
		}
	}
}
