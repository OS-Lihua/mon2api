import { z } from "zod";
import { codePointString, MAX_MESSAGES_BYTES } from "./mon2api.contract";
export const addressSchema = z.string().regex(/^0x[\da-fA-F]{40}$/);
export const sessionIdSchema = z.string().regex(/^0x[\da-fA-F]{64}$/);
export const listingInput = z
	.object({
		name: codePointString({ trim: true, min: 2, max: 64 }),
		description: codePointString({ trim: true, min: 2, max: 300 }),
		model: z
			.string()
			.trim()
			.regex(/^[\w./:-]{1,100}$/),
		kind: z.enum(["demo", "gateway"]),
		inputRate: z.number().int().min(1).max(1_000_000_000),
		outputRate: z.number().int().min(1).max(1_000_000_000),
		concurrency: z.number().int().min(1).max(20).default(2),
		baseUrl: z.string().url().optional(),
		apiKey: codePointString({ min: 1, max: 2048 }).optional(),
	})
	.strict()
	.superRefine((v, ctx) => {
		if (v.kind === "gateway" && (!v.baseUrl || !v.apiKey))
			ctx.addIssue({
				code: "custom",
				message: "真实连接器需要 URL 和 API Key",
			});
	});
export const openSessionInput = z
	.object({
		listingId: z.string().cuid(),
		budget: z.number().int().min(1_000_000).max(100_000_000),
	})
	.strict();
export const messagesSchema = z
	.array(
		z
			.object({
				role: z.enum(["system", "user", "assistant"]),
				content: codePointString({ max: 8000 }),
			})
			.strict(),
	)
	.min(1)
	.max(20)
	.refine(
		(v) => Buffer.byteLength(JSON.stringify(v), "utf8") <= MAX_MESSAGES_BYTES,
		"输入最多 24000 个 UTF-8 字节（messages JSON 序列化后）",
	)
	.openapi({
		description:
			"JSON.stringify(messages), including array/object syntax and JSON escaping, must encode to at most 24000 UTF-8 bytes. This runtime byte refinement cannot be expressed by standard JSON Schema maxLength/maxItems; clients must enforce it separately. Content length limits count Unicode code points.",
	});
export const chatInput = z
	.object({
		sessionId: sessionIdSchema,
		messages: messagesSchema,
		maxTokens: z.number().int().min(128).max(2048).default(512),
		conversationId: codePointString({ min: 1, max: 120 }).default("default"),
		idempotencyKey: codePointString({ min: 8, max: 128 }),
	})
	.strict();
export const publicChatInput = z
	.object({
		model: codePointString({ min: 1, max: 100 }),
		messages: messagesSchema,
		max_tokens: z.number().int().min(128).max(2048).default(512),
		stream: z.boolean().default(false),
		stream_options: z
			.object({ include_usage: z.boolean().optional() })
			.strict()
			.optional(),
		conversation_id: codePointString({ min: 1, max: 120 }).default("default"),
	})
	.strict();
