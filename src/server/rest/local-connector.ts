import "server-only";
import { z } from "zod";
import {
	AppError,
	assertSameOrigin,
	requireViewer,
} from "~/server/services/auth";
import {
	authenticateConnector,
	connectorSetup,
	connectorStatus,
	createConnectorLaunch,
	createLocalDraft,
	createLocalListing,
	disconnectConnector,
	pollConnector,
	publishLocalDraft,
	redeemConnectorLaunch,
	reportConnectorCatalog,
	rotateConnector,
	updateConnector,
} from "~/server/services/local-connector";
import {
	connectorCreated,
	connectorListingId,
	connectorSetupResponse,
	directDiscoveryInput,
	localDraftInput,
	localListingInput,
	publishLocalInput,
} from "~/server/services/local-connector.schema";
import { discoverDirectModels } from "~/server/services/market";
import {
	connectorCatalogInput,
	connectorLaunchResponse,
	connectorOk,
	connectorPollInput,
	connectorPollResponse,
	connectorStatusResponse,
	connectorTokenResponse,
	connectorUpdate,
} from "~/shared/connector";
import { modelCatalogResponse } from "~/shared/model-catalog";
import { createRestMutation, createRestQuery } from "./endpoint";

async function result<T extends z.ZodTypeAny>(
	schema: T,
	action: () => Promise<unknown>,
) {
	try {
		return Response.json(schema.parse(await action()));
	} catch (error) {
		if (!(error instanceof AppError)) throw error;
		return Response.json(
			{ error: { code: error.code, message: error.message } },
			{ status: error.status },
		);
	}
}
function noStore(handler: (request: Request) => Promise<Response>) {
	return async (request: Request) => {
		const response = await handler(request);
		response.headers.set("Cache-Control", "no-store");
		response.headers.set("X-Content-Type-Options", "nosniff");
		return response;
	};
}
/** Connector-token routes are limited per listing instead of per IP. */
const connectorSubject = async (request: Request) =>
	`connector:${(await authenticateConnector(request.headers.get("authorization"))).listing.id}`;
function mutation<T extends z.ZodTypeAny, U extends z.ZodTypeAny>(
	route: string,
	input: T,
	output: U,
	action: (request: Request, input: z.infer<T>) => Promise<unknown>,
	credential?: (request: Request) => Promise<string>,
) {
	return noStore(
		createRestMutation({
			route,
			credential,
			input,
			handler: ({ request, input }) =>
				result(output, async () => {
					assertSameOrigin(request.headers);
					return action(request, input);
				}),
		}),
	);
}
async function merchant(request: Request) {
	if (request.headers.has("authorization"))
		throw new AppError(
			"unauthorized",
			"此操作需要钱包登录，不接受连接器或推理凭证。",
			401,
		);
	return requireViewer();
}
export const createConnectorPost = mutation(
	"connector:create",
	localListingInput,
	connectorCreated,
	async (request, input) => createLocalListing(await merchant(request), input),
);
export const createConnectorLaunchPost = mutation(
	"connector:launch",
	connectorListingId,
	connectorLaunchResponse,
	async (request, input) =>
		createConnectorLaunch(await merchant(request), input.id),
);
export const connectConnectorPost = mutation(
	"connector:connect",
	z.object({}).strict(),
	connectorTokenResponse,
	(request) => redeemConnectorLaunch(request.headers.get("authorization")),
);
export const createDraftPost = mutation(
	"connector:draft",
	localDraftInput,
	connectorCreated,
	async (request, input) => createLocalDraft(await merchant(request), input),
);
export const publishDraftPost = mutation(
	"connector:publish",
	publishLocalInput,
	connectorOk,
	async (request, input) => publishLocalDraft(await merchant(request), input),
);
export const setupConnectorPost = mutation(
	"connector:setup",
	connectorListingId,
	connectorSetupResponse,
	async (request, input) => connectorSetup(await merchant(request), input.id),
);
export const discoverModelsPost = mutation(
	"connector:discover",
	directDiscoveryInput,
	modelCatalogResponse,
	async (request, input) => {
		await merchant(request);
		return discoverDirectModels(input);
	},
);
export const catalogConnectorPost = mutation(
	"connector:catalog",
	connectorCatalogInput,
	connectorOk,
	(request, input) =>
		reportConnectorCatalog(request.headers.get("authorization"), input.models),
	connectorSubject,
);
export const rotateConnectorPost = mutation(
	"connector:rotate",
	connectorListingId,
	connectorCreated,
	async (request, input) => rotateConnector(await merchant(request), input.id),
);
export const pollConnectorPost = mutation(
	"connector:poll",
	connectorPollInput,
	connectorPollResponse,
	(request, input) =>
		pollConnector(request.headers.get("authorization"), input.model),
	connectorSubject,
);
export const updateConnectorPost = mutation(
	"connector:update",
	connectorUpdate,
	connectorOk,
	(request, input) =>
		updateConnector(request.headers.get("authorization"), input),
	connectorSubject,
);
export const disconnectConnectorPost = mutation(
	"connector:disconnect",
	z.object({}).strict(),
	connectorOk,
	(request) => disconnectConnector(request.headers.get("authorization")),
	connectorSubject,
);
export const connectorStatusGet = noStore(
	createRestQuery({
		route: "connector:status",
		credential: connectorSubject,
		handler: ({ request }) =>
			result(connectorStatusResponse, () =>
				connectorStatus(request.headers.get("authorization")),
			),
	}),
);
