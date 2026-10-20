import { z } from "zod";
import { SETTLEMENT_ASSETS } from "~/shared/settlement-asset";
import { codePointString } from "./token2api.contract";
import {
	addressSchema,
	sessionIdSchema,
	walletSignatureSchema,
} from "./token2api.schema";

export const pageQuery = z
	.object({
		limit: z.coerce.number().int().min(1).max(100).default(20),
		cursor: z.string().min(1).max(128).optional(),
	})
	.strict();
export const resourceQuery = pageQuery
	.extend({
		q: z.string().trim().max(100).optional(),
		kind: z.enum(["demo", "gateway"]).optional(),
	})
	.strict();
export const ledgerQuery = pageQuery
	.extend({
		sessionId: sessionIdSchema.optional(),
	})
	.strict();
export const requestQuery = ledgerQuery
	.extend({
		idempotencyKey: codePointString({ min: 8, max: 128 }).optional(),
	})
	.strict();
export const walletChallengeInput = z
	.object({ address: addressSchema })
	.strict();
export const walletLoginInput = z
	.object({
		address: addressSchema,
		message: z.string().max(1000),
		signature: walletSignatureSchema,
	})
	.strict();
export const confirmInput = z
	.object({ txHash: sessionIdSchema.optional() })
	.strict();
export const statusInput = z.object({ enabled: z.boolean() }).strict();
export const emptyInput = z.object({}).strict();
export const createKeyInput = z
	.object({
		sessionId: sessionIdSchema,
		name: z.string().trim().min(1).max(64),
	})
	.strict();
export const lookupQuery = z
	.object({
		idempotency_key: codePointString({ min: 8, max: 128 }),
	})
	.strict();

const amount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime();
export const viewerResponse = z
	.object({ address: addressSchema, name: z.string(), demo: z.boolean() })
	.strict();
export const okResponse = z.object({ ok: z.literal(true) }).strict();
export const idResponse = z.object({ id: z.string().cuid() }).strict();
export const buyerConnectionResponse = z
	.object({ base_url: z.string().url(), key: z.string(), model: z.string() })
	.strict();
export const challengeResponse = z.object({ message: z.string() }).strict();
export const networkResponse = z
	.object({
		asset: z.enum(SETTLEMENT_ASSETS),
		tokenDecimals: z.number().int().min(6).max(18),
		ledgerUnit: z.enum([
			"micro_ETH",
			"micro_BNB",
			"micro_POL",
			"micro_AVAX",
			"micro_USDT",
			"micro_USDC",
			"micro_dUSD",
		]),
		balanceUnit: z.enum(["wei", "atomic", "micro_dUSD"]),
		mode: z.enum(["local", "evm"]),
		chainId: z.number().int(),
		token: addressSchema,
		escrow: addressSchema,
		feeBps: z.number().int(),
		ready: z.boolean(),
		rpcUrl: z.string().url(),
		explorer: z.string(),
	})
	.strict();
export const balancesResponse = z
	.object({
		walletBalance: z.string().regex(/^\d+$/),
		claimable: z.string().regex(/^\d+$/),
		unit: z.enum(["wei", "atomic", "micro_dUSD"]),
	})
	.strict();
export const resourceResponse = z
	.object({
		id: z.string().cuid(),
		owner: addressSchema,
		name: z.string(),
		description: z.string(),
		model: z.string(),
		kind: z.enum(["demo", "gateway"]),
		transport: z.enum(["direct", "local"]),
		online: z.boolean(),
		inputRate: amount,
		outputRate: amount,
		concurrency: z.number().int().positive(),
		enabled: z.boolean(),
		status: z.string(),
		createdAt: timestamp,
	})
	.strict();
export const sessionResponse = z
	.object({
		id: sessionIdSchema,
		listingId: z.string().cuid(),
		consumer: addressSchema,
		provider: addressSchema,
		model: z.string(),
		inputRate: amount,
		outputRate: amount,
		termsHash: sessionIdSchema,
		budget: amount,
		spent: amount,
		reserved: amount,
		settled: amount,
		writtenOff: amount,
		availableBudget: amount,
		status: z.string(),
		expiresAt: timestamp,
		createdAt: timestamp,
		openTx: sessionIdSchema.nullable(),
		closeTx: sessionIdSchema.nullable(),
	})
	.strict();
export const requestResponse = z
	.object({
		id: z.string().cuid(),
		sessionId: sessionIdSchema,
		status: z.string(),
		inputTokens: amount.nullable(),
		outputTokens: amount.nullable(),
		reservation: amount,
		cost: amount,
		usageSource: z.string(),
		upstreamRequestId: z.string().nullable(),
		errorCode: z.string().nullable(),
		createdAt: timestamp,
	})
	.strict();
export const keyResponse = z
	.object({
		id: z.string().cuid(),
		name: z.string(),
		prefix: z.string(),
		sessionId: sessionIdSchema,
		revoked: z.boolean(),
		createdAt: timestamp,
	})
	.strict();
export const settlementResponse = z
	.object({
		id: z.string().cuid(),
		sessionId: sessionIdSchema,
		nonce: z.number().int(),
		amount,
		cumulative: amount,
		receiptsHash: sessionIdSchema,
		status: z.string(),
		txHash: sessionIdSchema.nullable(),
		createdAt: timestamp,
	})
	.strict();
export function pageResponse<T extends z.ZodTypeAny>(item: T) {
	return z
		.object({
			data: z.array(item),
			nextCursor: z.string().nullable(),
			hasMore: z.boolean(),
		})
		.strict();
}
export const openSessionResponse = z
	.object({
		id: sessionIdSchema,
		mode: z.enum(["demo", "wallet"]),
		txHash: sessionIdSchema.optional(),
		connection: buyerConnectionResponse.optional(),
		transaction: z
			.object({
				id: sessionIdSchema,
				provider: addressSchema,
				termsHash: sessionIdSchema,
				budget: amount,
				expiresAt: z.number().int(),
			})
			.strict(),
	})
	.strict();
export const confirmedResponse = z
	.object({
		id: sessionIdSchema,
		status: z.literal("ACTIVE"),
		connection: buyerConnectionResponse.optional(),
	})
	.strict();
export const transactionResponse = z
	.object({ txHash: sessionIdSchema.nullable() })
	.strict();

export const refundResponse = z
	.object({
		sessionId: sessionIdSchema,
		status: z.enum(["PROCESSING", "PENDING_REVIEW", "AVAILABLE"]),
		amount,
		reserved: amount,
		unit: z.enum([
			"micro_ETH",
			"micro_BNB",
			"micro_POL",
			"micro_AVAX",
			"micro_USDT",
			"micro_USDC",
			"micro_dUSD",
		]),
		requestedAt: timestamp,
		txHash: sessionIdSchema.nullable(),
		withdrawRequired: z.boolean(),
	})
	.strict();
