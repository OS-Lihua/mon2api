import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "~/server/db";
import { AppError } from "~/server/services/auth";
import { authenticateKey } from "~/server/services/market";
import { runChat } from "~/server/services/metering";
import { publicChatInput } from "~/server/services/mon2api.schema";
import { createRestMutation, createRestQuery } from "./endpoint";

const headers = {
	"Cache-Control": "no-store",
	"X-Content-Type-Options": "nosniff",
};
function errorResponse(error: unknown) {
	const known = error instanceof AppError;
	return Response.json(
		{
			error: {
				code: known ? error.code : "internal_error",
				message: known ? error.message : "调用未完成，请检查服务状态。",
			},
		},
		{ status: known ? error.status : 500, headers },
	);
}
export const chatPost = createRestMutation({
	route: "mon2api:chat",
	input: publicChatInput,
	handler: async ({ input, request }) => {
		try {
			const key = await authenticateKey(request.headers.get("authorization"));
			const lease = await db.lease.findUnique({ where: { id: key.sessionId } });
			if (!lease || lease.model !== input.model)
				throw new AppError(
					"model_not_available",
					"模型不属于此 API Key 绑定的租赁会话。",
					400,
				);
			const idempotencyKey =
				request.headers.get("idempotency-key") || randomUUID();
			if (idempotencyKey.length < 8 || idempotencyKey.length > 128)
				throw new AppError(
					"invalid_request",
					"Idempotency-Key 长度必须为 8 到 128。",
				);
			const args = {
				sessionId: key.sessionId,
				messages: input.messages,
				maxTokens: input.max_tokens,
				conversationId: input.conversation_id,
				idempotencyKey,
			};
			const id = `chatcmpl-${randomUUID()}`;
			const created = Math.floor(Date.now() / 1000);
			if (!input.stream) {
				const result = await runChat(
					key.owner,
					args,
					() => undefined,
					request.signal,
					key.id,
				);
				return Response.json(
					{
						id,
						object: "chat.completion",
						created,
						model: input.model,
						choices: [
							{
								index: 0,
								message: { role: "assistant", content: result.text },
								finish_reason: "stop",
							},
						],
						usage: {
							prompt_tokens: result.inputTokens,
							completion_tokens: result.outputTokens,
							total_tokens: result.inputTokens + result.outputTokens,
						},
						mon2api: {
							request_id: result.id,
							cost: result.cost,
							unit: "micro_dUSD",
							usage_source: result.usageSource,
						},
					},
					{ headers: { ...headers, "x-idempotency-key": idempotencyKey } },
				);
			}
			const encoder = new TextEncoder();
			const abort = new AbortController();
			const signal = AbortSignal.any([request.signal, abort.signal]);
			const body = new ReadableStream<Uint8Array>({
				async start(controller) {
					const emit = (value: unknown) => {
						if (!abort.signal.aborted)
							controller.enqueue(
								encoder.encode(`data: ${JSON.stringify(value)}\n\n`),
							);
					};
					const chunk = (choices: unknown[], usage?: unknown) => ({
						id,
						object: "chat.completion.chunk",
						created,
						model: input.model,
						choices,
						...(usage ? { usage } : {}),
					});
					try {
						const result = await runChat(
							key.owner,
							args,
							(delta) =>
								emit(
									chunk([
										{
											index: 0,
											delta: { content: delta },
											finish_reason: null,
										},
									]),
								),
							signal,
							key.id,
						);
						emit(chunk([{ index: 0, delta: {}, finish_reason: "stop" }]));
						if (input.stream_options?.include_usage)
							emit(
								chunk([], {
									prompt_tokens: result.inputTokens,
									completion_tokens: result.outputTokens,
									total_tokens: result.inputTokens + result.outputTokens,
								}),
							);
					} catch (error) {
						emit({
							error: {
								code: error instanceof AppError ? error.code : "internal_error",
								message:
									error instanceof AppError ? error.message : "调用未完成。",
							},
						});
					} finally {
						if (!abort.signal.aborted) {
							controller.enqueue(encoder.encode("data: [DONE]\n\n"));
							controller.close();
						}
					}
				},
				cancel() {
					abort.abort();
				},
			});
			return new Response(body, {
				headers: {
					...headers,
					"Content-Type": "text/event-stream; charset=utf-8",
					Connection: "keep-alive",
					"x-idempotency-key": idempotencyKey,
				},
			});
		} catch (error) {
			return errorResponse(error);
		}
	},
});
export const modelsGet = createRestQuery({
	route: "mon2api:models",
	handler: async ({ request }) => {
		try {
			const key = await authenticateKey(request.headers.get("authorization"));
			const lease = await db.lease.findUniqueOrThrow({
				where: { id: key.sessionId },
			});
			return Response.json(
				{
					object: "list",
					data: [
						{
							id: lease.model,
							object: "model",
							created: Math.floor(lease.createdAt.getTime() / 1000),
							owned_by: lease.provider,
						},
					],
				},
				{ headers },
			);
		} catch (error) {
			return errorResponse(error);
		}
	},
});
