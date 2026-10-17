import { z } from "zod";

// Use the same model identifiers accepted by resource creation. Ignore other
// upstream metadata: it may contain private provider configuration.
export const discoveredModel = z.string().regex(/^[\w./:@-]{1,100}$/);
export const modelCatalog = z
	.array(discoveredModel)
	.max(500)
	.refine(
		(models) => new Set(models).size === models.length,
		"模型 ID 不能重复",
	);
export const modelCatalogResponse = z.object({ models: modelCatalog }).strict();
