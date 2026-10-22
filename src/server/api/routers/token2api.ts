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
	walletSignatureSchema,
} from "~/server/services/auth";
import {
	connectorSetup,
	createConnectorLaunch,
	createLocalDraft,
	createLocalListing,
	publishLocalDraft,
	rotateConnector,
} from "~/server/services/local-connector";
import {
	connectorListingId,
	directDiscoveryInput,
	localDraftInput,
	localListingInput,
	publishLocalInput,
} from "~/server/services/local-connector.schema";
import {
	confirmSession,
	createKey,
	createListing,
	discoverDirectModels,
	openSession,
	revokeKey,
	snapshot,
	toggleListing,
	updateListing,
	withdraw,
} from "~/server/services/market";
import { runChat } from "~/server/services/metering";
import {
	listEndpointPolicies,
	operatorResources,
	operatorStatus,
	saveEndpointPolicy,
	setEndpointStatus,
} from "~/server/services/operator";
import { operatorResourcesInput } from "~/server/services/operator.schema";
import { refundStatus, requestRefund } from "~/server/services/refund";
import { closeSession, settleSession } from "~/server/services/settlement";
import {
	addressSchema,
	chatInput,
	listingInput,
	listingUpdateInput,
	openSessionInput,
	sessionIdSchema,
} from "~/server/services/token2api.schema";
import {
	endpointPolicyInput,
	endpointStatusInput,
} from "~/shared/gateway-config";

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
	await call(async () => assertSameOrigin(ctx.headers));
	return next();
});
export const token2apiRouter = createTRPCRouter({
	operatorStatus: publicProcedure.query(() =>
		call(async () => operatorStatus(await viewer())),
	),
	endpointPolicies: publicProcedure.query(() =>
		call(async () => listEndpointPolicies(await requireViewer())),
	),
	saveEndpointPolicy: mutation
		.input(endpointPolicyInput)
		.mutation(({ input }) =>
			call(async () => saveEndpointPolicy(await requireViewer(), input)),
		),
	setEndpointStatus: mutation
		.input(endpointStatusInput)
		.mutation(({ input }) =>
			call(async () => setEndpointStatus(await requireViewer(), input)),
		),
	operatorResources: publicProcedure
		.input(operatorResourcesInput)
		.query(({ input }) =>
			call(async () => operatorResources(await requireViewer(), input)),
		),
	createConnectorLaunch: mutation
		.input(connectorListingId)
		.mutation(({ input }) =>
			call(async () => createConnectorLaunch(await requireViewer(), input.id)),
		),
	snapshot: publicProcedure
		.input(z.object({ gatewayOnly: z.boolean() }).strict().optional())
		.query(({ input }) =>
			call(async () => snapshot(await viewer(), input?.gatewayOnly)),
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
				signature: walletSignatureSchema,
			}),
		)
		.mutation(({ input }) =>
			call(() => walletLogin(input.address, input.message, input.signature)),
		),
	createLocalListing: mutation
		.input(localListingInput)
		.mutation(({ input }) =>
			call(async () => createLocalListing(await requireViewer(), input)),
		),
	createLocalDraft: mutation
		.input(localDraftInput)
		.mutation(({ input }) =>
			call(async () => createLocalDraft(await requireViewer(), input)),
		),
	connectorSetup: publicProcedure
		.input(connectorListingId)
		.query(({ input }) =>
			call(async () => connectorSetup(await requireViewer(), input.id)),
		),
	publishLocalDraft: mutation
		.input(publishLocalInput)
		.mutation(({ input }) =>
			call(async () => publishLocalDraft(await requireViewer(), input)),
		),
	discoverModels: mutation.input(directDiscoveryInput).mutation(({ input }) =>
		call(async () => {
			await requireViewer();
			return discoverDirectModels(input);
		}),
	),
	rotateConnector: mutation
		.input(connectorListingId)
		.mutation(({ input }) =>
			call(async () => rotateConnector(await requireViewer(), input.id)),
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
	updateListing: mutation
		.input(
			z.object({ id: z.string().cuid(), changes: listingUpdateInput }).strict(),
		)
		.mutation(({ input }) =>
			call(async () =>
				updateListing(await requireViewer(), input.id, input.changes),
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
				confirmSession(await requireViewer(), input.id, input.txHash, true),
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
	requestRefund: mutation
		.input(z.object({ sessionId: sessionIdSchema }).strict())
		.mutation(({ input }) =>
			call(async () => requestRefund(await requireViewer(), input.sessionId)),
		),
	refundStatus: publicProcedure
		.input(z.object({ sessionId: sessionIdSchema }).strict())
		.query(({ input }) =>
			call(async () => refundStatus(await requireViewer(), input.sessionId)),
		),
	withdraw: mutation.mutation(() =>
		call(async () => withdraw(await requireViewer())),
	),
});
