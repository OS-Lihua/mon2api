import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
	AppError,
	assertSameOrigin,
	demoLogin,
	logout,
	requireViewer,
	viewer,
	walletChallenge,
	walletLogin,
} from "~/server/services/auth";
import {
	confirmSession,
	createKey,
	createListing,
	openSession,
	revokeKey,
	snapshot,
	toggleListing,
	withdraw,
} from "~/server/services/market";
import { runChat } from "~/server/services/metering";
import {
	addressSchema,
	chatInput,
	listingInput,
	openSessionInput,
	sessionIdSchema,
} from "~/server/services/mon2api.schema";
import { closeSession, settleSession } from "~/server/services/settlement";

async function call<T>(action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	} catch (error) {
		if (error instanceof AppError) {
			const code =
				error.status === 401
					? "UNAUTHORIZED"
					: error.status === 403
						? "FORBIDDEN"
						: error.status === 404
							? "NOT_FOUND"
							: error.status === 429
								? "TOO_MANY_REQUESTS"
								: error.status === 409
									? "CONFLICT"
									: error.status === 402
										? "PRECONDITION_FAILED"
										: "BAD_REQUEST";
			throw new TRPCError({ code, message: error.message });
		}
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "操作未完成，请检查链与服务状态后重试。",
		});
	}
}
const mutation = publicProcedure.use(async ({ ctx, next }) => {
	assertSameOrigin(ctx.headers);
	return next();
});
export const mon2apiRouter = createTRPCRouter({
	snapshot: publicProcedure.query(() =>
		call(async () => snapshot(await viewer())),
	),
	demoLogin: mutation
		.input(z.object({ role: z.enum(["consumer", "provider"]) }))
		.mutation(({ input }) => call(() => demoLogin(input.role))),
	logout: mutation.mutation(() => call(logout)),
	walletChallenge: mutation
		.input(z.object({ address: addressSchema }))
		.mutation(({ input }) => call(() => walletChallenge(input.address))),
	walletLogin: mutation
		.input(
			z.object({
				address: addressSchema,
				message: z.string().max(1000),
				signature: z.string().max(1000),
			}),
		)
		.mutation(({ input }) =>
			call(() => walletLogin(input.address, input.message, input.signature)),
		),
	createListing: mutation
		.input(listingInput)
		.mutation(({ input }) =>
			call(async () => createListing(await requireViewer(), input)),
		),
	toggleListing: mutation
		.input(z.object({ id: z.string().cuid(), enabled: z.boolean() }))
		.mutation(({ input }) =>
			call(async () =>
				toggleListing(await requireViewer(), input.id, input.enabled),
			),
		),
	openSession: mutation
		.input(openSessionInput)
		.mutation(({ input }) =>
			call(async () => openSession(await requireViewer(), input)),
		),
	confirmSession: mutation
		.input(
			z.object({
				id: sessionIdSchema,
				txHash: z
					.string()
					.regex(/^0x[\da-fA-F]{64}$/)
					.optional(),
			}),
		)
		.mutation(({ input }) =>
			call(async () =>
				confirmSession(await requireViewer(), input.id, input.txHash),
			),
		),
	createKey: mutation
		.input(
			z.object({
				sessionId: sessionIdSchema,
				name: z.string().trim().min(1).max(64),
			}),
		)
		.mutation(({ input }) =>
			call(async () =>
				createKey(await requireViewer(), input.sessionId, input.name),
			),
		),
	revokeKey: mutation
		.input(z.object({ id: z.string().cuid() }))
		.mutation(({ input }) =>
			call(async () => revokeKey(await requireViewer(), input.id)),
		),
	chat: mutation
		.input(chatInput)
		.mutation(({ input }) =>
			call(async () => runChat((await requireViewer()).address, input)),
		),
	settle: mutation
		.input(z.object({ sessionId: sessionIdSchema }))
		.mutation(({ input }) =>
			call(async () =>
				settleSession(input.sessionId, (await requireViewer()).address),
			),
		),
	closeSession: mutation
		.input(z.object({ sessionId: sessionIdSchema }))
		.mutation(({ input }) =>
			call(async () =>
				closeSession(input.sessionId, (await requireViewer()).address),
			),
		),
	withdraw: mutation.mutation(() =>
		call(async () => withdraw(await requireViewer())),
	),
});
