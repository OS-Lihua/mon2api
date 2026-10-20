import { chainConfig } from "~/server/services/runtime";
import { assetOf, billingUnit } from "~/shared/settlement-asset";
import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "~/server/db";
import { AppError } from "~/server/services/auth";
import { authenticateKey } from "~/server/services/market";
import { runChat } from "~/server/services/metering";
import { publicChatInput } from "~/server/services/token2api.schema";
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
// One key lookup per request, shared by the rate limiter and the handler.
const verifiedKeys = new WeakMap<Request, ReturnType<typeof authenticateKey>>();
function requestKey(request: Request) {
	let key = verifiedKeys.get(request);
	if (!key) {
		key = authenticateKey(request.headers.get("authorization"));
		verifiedKeys.set(request, key);
	}
	return key;
}
const keySubject = async (request: Request) =>
	`key:${(await requestKey(request)).id}`;
export const chatPost = createRestMutation({
	route: "token2api:chat",
	credential: keySubject,
	input: publicChatInput,
	handler: async ({ input, request }) => {
		try {
			const key = await requestKey(request);
			const lease = await db.lease.findUnique({ where: { id: key.sessionId } });
			if (!lease || lease.model !== input.model)
				throw new AppError(
					"model_not_available",
					"模型不属于此 API Key 绑定的租赁会话。",
					400,
				);
			const idempotencyKey = request.headers.get("idempotency-key");
			if (
				!idempotencyKey ||
				idempotencyKey.length < 8 ||
				idempotencyKey.length > 128
			)
				throw new AppError(
					"invalid_request",
					"必须提供长度为 8 到 128 的 Idempotency-Key。",
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
				const billingMetadata = {
					request_id: result.id,
					cost: result.cost,
					unit: billingUnit(assetOf(chainConfig())),
					usage_source: result.usageSource,
				};
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
								finish_reason: result.finishReason,
							},
						],
						usage: {
							prompt_tokens: result.inputTokens,
							completion_tokens: result.outputTokens,
							total_tokens: result.inputTokens + result.outputTokens,
						},
						token2api: billingMetadata,
						mon2api: billingMetadata,
					},
					{ headers: { ...headers, "x-idempotency-key": idempotencyKey } },
				);
			}
			const encoder = new TextEncoder();
			let cancelled = false;
			const body = new ReadableStream<Uint8Array>({
				async start(controller) {
					const emit = (value: unknown) => {
						if (!cancelled && !request.signal.aborted)
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
							undefined,
							key.id,
						);
						emit(
							chunk([
								{ index: 0, delta: {}, finish_reason: result.finishReason },
							]),
						);
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
						if (!cancelled && !request.signal.aborted) {
							controller.enqueue(encoder.encode("data: [DONE]\n\n"));
							controller.close();
						}
					}
				},
				cancel() {
					cancelled = true;
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
	route: "token2api:models",
	credential: keySubject,
	handler: async ({ request }) => {
		try {
			const key = await requestKey(request);
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
