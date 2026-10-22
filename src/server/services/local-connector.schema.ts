import { z } from "zod";
import { connectorTokenSchema } from "~/shared/connector";
import { discoveredModel, modelCatalog } from "~/shared/model-catalog";
import { listingInput } from "./token2api.schema";

export const localListingInput = listingInput.options[1]
	.omit({ baseUrl: true, apiKey: true, proxy: true, concurrency: true })
	.extend({ concurrency: z.literal(1).default(1) });
export const connectorCreated = z
	.object({ id: z.string().cuid(), token: connectorTokenSchema })
	.strict();
export const connectorListingId = z.object({ id: z.string().cuid() }).strict();
export const localDraftInput = localListingInput.omit({
	model: true,
	inputRate: true,
	outputRate: true,
});
export const publishLocalInput = z
	.object({
		id: z.string().cuid(),
		model: discoveredModel,
		inputRate: localListingInput.shape.inputRate,
		outputRate: localListingInput.shape.outputRate,
	})
	.strict();
export const connectorSetupResponse = z
	.object({
		id: z.string().cuid(),
		model: z.string(),
		status: z.string(),
		online: z.boolean(),
		models: modelCatalog,
	})
	.strict();
export const directDiscoveryInput = listingInput.options[1].pick({
	baseUrl: true,
	apiKey: true,
	proxy: true,
});
