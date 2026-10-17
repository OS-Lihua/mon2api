import { describe, expect, it } from "vitest";
import { openApiDocument } from "./document";

describe("mon2api OpenAPI", () => {
	it("documents authenticated versioned model and chat endpoints", () => {
		expect(openApiDocument.openapi).toBe("3.1.0");
		expect(openApiDocument.paths["/models"].get.operationId).toBe("listModels");
		expect(openApiDocument.paths["/chat/completions"].post.operationId).toBe(
			"createChatCompletion",
		);
		expect(openApiDocument.security).toEqual([{ bearerAuth: [] }]);
	});
	it("documents the stream and budget failures", () => {
		const responses = openApiDocument.paths["/chat/completions"].post.responses;
		expect(responses["402"]).toBeDefined();
		expect(responses["409"]).toBeDefined();
		expect(responses["429"]).toBeDefined();
		expect(responses["200"].content["text/event-stream"]).toBeDefined();
	});
});
