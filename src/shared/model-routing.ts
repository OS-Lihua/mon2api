import { z } from "zod";

export const modelId = z
	.string()
	.trim()
	.regex(
		/^[\w./:@-]{1,100}$/,
		"模型 ID 格式无效，支持 1–100 个字母、数字及 _ . / : @ -。",
	);
const price = z
	.number()
	.int()
	.min(1, "报价必须大于零。")
	.max(1_000_000_000, "报价不能超过 1000 单位结算资产 / 百万 Token。");
export const modelProductInput = z
	.object({
		id: modelId,
		name: z.string().trim().min(1).max(100),
		inputRate: price,
		outputRate: price,
		enabled: z.boolean(),
	})
	.strict();
export const modelRouteInput = z
	.object({
		modelId,
		listingId: z.string().cuid(),
		priority: z.number().int().min(0).max(1000),
		enabled: z.boolean(),
	})
	.strict();
export const keyModels = z
	.array(modelId)
	.min(1)
	.max(100)
	.refine(
		(models) => new Set(models).size === models.length,
		"不能重复选择模型。",
	);
export const modelKeyInput = z
	.object({
		name: z.string().trim().min(1).max(64),
		models: keyModels,
	})
	.strict();
export const updateKeyModelsInput = z
	.object({
		id: z.string().cuid(),
		models: keyModels,
	})
	.strict();

export const modelChatInput = z.object({
	keyId: z.string().cuid(),
	model: modelId,
});
export const prepaidTransferInput = z
	.object({
		kind: z.enum(["deposit", "withdraw"]),
		amount: z.number().int().positive().safe(),
	})
	.strict();
export const modelProductResponse = z
	.object({
		id: modelId,
		name: z.string(),
		inputRate: price,
		outputRate: price,
		available: z.boolean(),
	})
	.strict();
const amount = z.number().int().nonnegative().safe();
export const prepaidAccountResponse = z
	.object({
		balance: z.string().regex(/^\d+$/),
		available: amount,
		preparing: amount,
		reserved: amount,
		pendingSettlement: amount,
		releasing: amount,
	})
	.strict();
export const prepaidTransactionResponse = z
	.object({
		chainId: z.number().int().positive(),
		amount,
		transactions: z
			.array(
				z
					.object({
						to: z.string().regex(/^0x[\da-fA-F]{40}$/),
						data: z.string().regex(/^0x[\da-fA-F]*$/),
						value: z.string().regex(/^\d+$/),
					})
					.strict(),
			)
			.min(1)
			.max(3),
	})
	.strict();

export type ModelView = z.infer<typeof modelProductResponse>;
export type PrepaidAccountView = z.infer<typeof prepaidAccountResponse>;
