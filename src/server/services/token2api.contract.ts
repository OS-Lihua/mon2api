import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const MAX_RAW_BODY_BYTES = 160 * 1024;
export const BODY_READ_TIMEOUT_MS = 10_000;
export const MAX_MESSAGES_BYTES = 24_000;

// Zod 3's string min/max count UTF-16 code units. JSON Schema counts code points.
// Keep the runtime refinement and the generated standard keywords in agreement.
export function codePointString(options: {
	min?: number;
	max: number;
	trim?: boolean;
}) {
	const string = options.trim ? z.string().trim() : z.string();
	return string
		.superRefine((value, ctx) => {
			const length = Array.from(value).length;
			if (options.min !== undefined && length < options.min) {
				ctx.addIssue({
					code: z.ZodIssueCode.too_small,
					type: "string",
					minimum: options.min,
					inclusive: true,
					message: `String must contain at least ${options.min} Unicode code point(s)`,
				});
			}
			if (length > options.max) {
				ctx.addIssue({
					code: z.ZodIssueCode.too_big,
					type: "string",
					maximum: options.max,
					inclusive: true,
					message: `String must contain at most ${options.max} Unicode code point(s)`,
				});
			}
		})
		.openapi({
			...(options.min === undefined ? {} : { minLength: options.min }),
			maxLength: options.max,
			description: "Length is counted in Unicode code points.",
		});
}

const finishReasonSchema = z.enum(["stop", "length", "content_filter"]);

export const usageResponseSchema = z
	.object({
		prompt_tokens: z.number().int().nonnegative(),
		completion_tokens: z.number().int().nonnegative(),
		total_tokens: z.number().int().nonnegative(),
	})
	.openapi("Usage");

export const modelListResponseSchema = z.object({
	object: z.literal("list"),
	data: z.array(
		z.object({
			id: z.string(),
			object: z.literal("model"),
			created: z.number().int(),
			owned_by: z.string(),
		}),
	),
});

const billingMetadataSchema = z.object({
	request_id: z.string(),
	cost: z.number().int().nonnegative(),
	unit: z.enum([
		"micro_ETH",
		"micro_BNB",
		"micro_POL",
		"micro_AVAX",
		"micro_USDT",
		"micro_USDC",
		"micro_dUSD",
	]),
	usage_source: z.enum(["demo", "upstream_reported"]),
});

export const completionResponseSchema = z.object({
	id: z.string(),
	object: z.literal("chat.completion"),
	created: z.number().int(),
	model: z.string(),
	choices: z.array(
		z.object({
			index: z.number().int(),
			message: z.object({
				role: z.literal("assistant"),
				content: z.string(),
			}),
			finish_reason: finishReasonSchema,
		}),
	),
	usage: usageResponseSchema,
	token2api: billingMetadataSchema,
});

export const streamChunkResponseSchema = z.object({
	id: z.string(),
	object: z.literal("chat.completion.chunk"),
	created: z.number().int(),
	model: z.string(),
	choices: z.array(
		z.object({
			index: z.number().int(),
			delta: z.object({ content: z.string().optional() }),
			finish_reason: z.union([finishReasonSchema, z.null()]),
		}),
	),
	usage: usageResponseSchema.optional(),
});

export const apiErrorResponseSchema = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
		details: z.unknown().optional(),
	}),
});
