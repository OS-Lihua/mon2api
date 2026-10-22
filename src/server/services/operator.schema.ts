import { z } from "zod";

export const operatorResourcesInput = z
	.object({
		endpointId: z.string().cuid().optional(),
		cursor: z.string().cuid().optional(),
		limit: z.number().int().min(1).max(100).default(25),
	})
	.strict();
