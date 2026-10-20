import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import type { z } from "zod";
import { z as schema } from "zod";
import {
	connectorCreated,
	connectorListingId,
	connectorSetupResponse,
	directDiscoveryInput,
	localDraftInput,
	localListingInput,
	publishLocalInput,
} from "~/server/services/local-connector.schema";
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

export function registerLocalConnector(
	registry: OpenAPIRegistry,
	error: z.ZodTypeAny,
) {
	registry.registerComponent("securitySchemes", "connectorAuth", {
		type: "http",
		scheme: "bearer",
		bearerFormat: "t2c_ resource-scoped connector credential",
	});
	registry.registerComponent("securitySchemes", "connectorLaunchAuth", {
		type: "http",
		scheme: "bearer",
		bearerFormat: "t2l_ single-use launch code; expires after five minutes",
	});
	const operations: {
		path: string;
		method: "get" | "post";
		operationId: string;
		summary: string;
		auth: "walletSession" | "connectorAuth" | "connectorLaunchAuth";
		input?: z.ZodTypeAny;
		output: z.ZodTypeAny;
	}[] = [
		{
			path: "/merchant/connectors/launch",
			method: "post",
			operationId: "createConnectorLaunch",
			summary:
				"Create a five-minute single-use launch code for an owned resource; replaces any previous launch code without interrupting a running connector",
			auth: "walletSession",
			input: connectorListingId,
			output: connectorLaunchResponse,
		},
		{
			path: "/connector/connect",
			method: "post",
			operationId: "redeemConnectorLaunch",
			summary:
				"Atomically consume a launch code and replace the resource connector credential; invalid or expired codes return 401",
			auth: "connectorLaunchAuth",
			input: schema.object({}).strict(),
			output: connectorTokenResponse,
		},
		{
			path: "/merchant/connectors/drafts",
			method: "post",
			operationId: "createLocalConnectorDraft",
			summary:
				"Create an unpublished local connection, without a model or prices",
			auth: "walletSession",
			input: localDraftInput,
			output: connectorCreated,
		},
		{
			path: "/merchant/connectors/setup",
			method: "post",
			operationId: "getOwnedConnectorSetup",
			summary:
				"Read the owned connection's discovered model IDs; never return upstream credentials",
			auth: "walletSession",
			input: connectorListingId,
			output: connectorSetupResponse,
		},
		{
			path: "/merchant/connectors/publish",
			method: "post",
			operationId: "publishDiscoveredConnectorModel",
			summary:
				"Publish one model from a fresh catalog on a live draft; model becomes immutable",
			auth: "walletSession",
			input: publishLocalInput,
			output: connectorOk,
		},
		{
			path: "/merchant/connectors/discover",
			method: "post",
			operationId: "discoverDirectGatewayModels",
			summary:
				"Read models under an operator-approved gateway API base path; no inference or resource creation",
			auth: "walletSession",
			input: directDiscoveryInput,
			output: modelCatalogResponse,
		},
		{
			path: "/connector/catalog",
			method: "post",
			operationId: "reportConnectorCatalog",
			summary:
				"Report up to 500 model IDs only; cannot change or publish a resource",
			auth: "connectorAuth",
			input: connectorCatalogInput,
			output: connectorOk,
		},
		{
			path: "/merchant/connectors/local",
			method: "post",
			operationId: "createLocalConnectorResource",
			summary: "Create a local resource; return its connector credential once",
			auth: "walletSession",
			input: localListingInput,
			output: connectorCreated,
		},
		{
			path: "/merchant/connectors/rotate",
			method: "post",
			operationId: "rotateLocalConnectorCredential",
			summary:
				"Revoke an owned resource's old connector credential and return a new one",
			auth: "walletSession",
			input: connectorListingId,
			output: connectorCreated,
		},
		{
			path: "/connector/status",
			method: "get",
			operationId: "getConnectorStatus",
			summary: "Read this connector's resource and heartbeat status",
			auth: "connectorAuth",
			output: connectorStatusResponse,
		},
		{
			path: "/connector/poll",
			method: "post",
			operationId: "pollConnectorJob",
			summary:
				"Heartbeat and atomically claim one non-replayable inference job",
			auth: "connectorAuth",
			input: connectorPollInput,
			output: connectorPollResponse,
		},
		{
			path: "/connector/updates",
			method: "post",
			operationId: "updateConnectorJob",
			summary: "Append cumulative text or report final usage for a claimed job",
			auth: "connectorAuth",
			input: connectorUpdate,
			output: connectorOk,
		},
		{
			path: "/connector/disconnect",
			method: "post",
			operationId: "disconnectConnector",
			summary: "Mark this connector offline without deleting its listing",
			auth: "connectorAuth",
			input: schema.object({}).strict(),
			output: connectorOk,
		},
	];
	for (const op of operations)
		registry.registerPath({
			method: op.method,
			path: op.path,
			operationId: op.operationId,
			summary: op.summary,
			tags: ["Local connector"],
			servers: [{ url: "/api/v1" }],
			security: [{ [op.auth]: [] }],
			description:
				"Local upstream URL and key stay on the merchant machine. Resource concurrency is one. Poll every 2 seconds; heartbeat expires after 15 seconds. Jobs expire after 40 seconds and are claimed at most once; never retry inference after a lost response or restart. Updates use increasing revisions and cumulative append-only text; repeating an acknowledged revision is harmless. Unknown usage retains its prepaid reservation in REVIEW. A connector credential is not a wallet management cookie or consumer inference key. Response text and prompts persist in the job for delivery/reconciliation. All responses are no-store; HTTPS is required outside loopback. Prices use integer micro-units per million tokens in the configured settlement asset; check /network ledgerUnit. Paid use still requires a funded, confirmed lease.",
			request: op.input
				? {
						body: {
							required: true,
							content: { "application/json": { schema: op.input } },
						},
					}
				: undefined,
			responses: {
				200: {
					description: "Success",
					content: { "application/json": { schema: op.output } },
				},
				...Object.fromEntries(
					[400, 401, 403, 404, 408, 409, 413, 429, 500].map((status) => [
						status,
						{
							description: "Structured error",
							content: { "application/json": { schema: error } },
						},
					]),
				),
			},
		});
}
