import "server-only";

export const openApiDocument = {
	openapi: "3.1.0",
	info: {
		title: "mon2api API",
		version: "0.1.0",
		description:
			"Text-only Chat Completions gateway. Off-chain metering and prepaid on-chain settlement. Test dUSD uses 6 decimals.",
	},
	servers: [
		{
			url: "/api/v1",
		},
		{
			url: "/v1",
		},
	],
	security: [
		{
			bearerAuth: [],
		},
	],
	paths: {
		"/models": {
			get: {
				operationId: "listModels",
				summary: "List the model bound to this API key",
				responses: {
					"200": {
						description: "OpenAI-compatible model list",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										object: {
											const: "list",
										},
										data: {
											type: "array",
											items: {
												type: "object",
												properties: {
													id: {
														type: "string",
													},
													object: {
														const: "model",
													},
													created: {
														type: "integer",
													},
													owned_by: {
														type: "string",
													},
												},
												required: ["id", "object", "created", "owned_by"],
											},
										},
									},
									required: ["object", "data"],
								},
							},
						},
					},
					"401": {
						description: "Structured API error",
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/Error",
								},
							},
						},
					},
					"429": {
						description: "Structured API error",
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/Error",
								},
							},
						},
					},
				},
			},
		},
		"/chat/completions": {
			post: {
				operationId: "createChatCompletion",
				summary: "Generate a metered text completion",
				description:
					"Text only, total serialized messages at most 24 KB. API key binds one lease/model. Duplicate Idempotency-Key returns 409 without another upstream call. A stream can emit an error after HTTP 200. Unknown usage retains its reservation in REVIEW. No automatic retry.",
				parameters: [
					{
						in: "header",
						name: "Idempotency-Key",
						schema: {
							type: "string",
							minLength: 8,
							maxLength: 128,
						},
					},
				],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								$ref: "#/components/schemas/ChatInput",
							},
						},
					},
				},
				responses: {
					"200": {
						description:
							"Completion or SSE chunks followed by [DONE]. include_usage adds a usage chunk.",
						headers: {
							"x-idempotency-key": {
								schema: {
									type: "string",
								},
							},
						},
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/Completion",
								},
							},
							"text/event-stream": {
								schema: {
									type: "string",
								},
							},
						},
					},
					"400": {
						description: "Structured API error",
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/Error",
								},
							},
						},
					},
					"401": {
						description: "Structured API error",
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/Error",
								},
							},
						},
					},
					"402": {
						description: "Structured API error",
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/Error",
								},
							},
						},
					},
					"409": {
						description: "Structured API error",
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/Error",
								},
							},
						},
					},
					"429": {
						description: "Structured API error",
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/Error",
								},
							},
						},
					},
					"502": {
						description: "Structured API error",
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/Error",
								},
							},
						},
					},
					"503": {
						description: "Structured API error",
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/Error",
								},
							},
						},
					},
				},
			},
		},
	},
	components: {
		securitySchemes: {
			bearerAuth: {
				type: "http",
				scheme: "bearer",
				bearerFormat: "mon2api API Key",
			},
		},
		schemas: {
			ChatInput: {
				type: "object",
				properties: {
					model: {
						type: "string",
						minLength: 1,
						maxLength: 100,
					},
					messages: {
						type: "array",
						minItems: 1,
						maxItems: 20,
						items: {
							type: "object",
							properties: {
								role: {
									type: "string",
									enum: ["system", "user", "assistant"],
								},
								content: {
									type: "string",
									maxLength: 8000,
								},
							},
							required: ["role", "content"],
							additionalProperties: false,
						},
					},
					max_tokens: {
						type: "integer",
						minimum: 128,
						maximum: 2048,
						default: 512,
					},
					stream: {
						type: "boolean",
						default: false,
					},
					stream_options: {
						type: "object",
						properties: {
							include_usage: {
								type: "boolean",
							},
						},
						additionalProperties: false,
					},
					conversation_id: {
						type: "string",
						minLength: 1,
						maxLength: 120,
						default: "default",
					},
				},
				required: ["model", "messages"],
				additionalProperties: false,
			},
			Usage: {
				type: "object",
				properties: {
					prompt_tokens: {
						type: "integer",
						minimum: 0,
					},
					completion_tokens: {
						type: "integer",
						minimum: 0,
					},
					total_tokens: {
						type: "integer",
						minimum: 0,
					},
				},
				required: ["prompt_tokens", "completion_tokens", "total_tokens"],
			},
			Completion: {
				type: "object",
				properties: {
					id: {
						type: "string",
					},
					object: {
						const: "chat.completion",
					},
					created: {
						type: "integer",
					},
					model: {
						type: "string",
					},
					choices: {
						type: "array",
						items: {
							type: "object",
							properties: {
								index: {
									type: "integer",
								},
								message: {
									type: "object",
									properties: {
										role: {
											const: "assistant",
										},
										content: {
											type: "string",
										},
									},
									required: ["role", "content"],
								},
								finish_reason: {
									const: "stop",
								},
							},
							required: ["index", "message", "finish_reason"],
						},
					},
					usage: {
						$ref: "#/components/schemas/Usage",
					},
					mon2api: {
						type: "object",
						properties: {
							request_id: {
								type: "string",
							},
							cost: {
								type: "integer",
								minimum: 0,
							},
							unit: {
								const: "micro_dUSD",
							},
							usage_source: {
								type: "string",
								enum: ["demo", "upstream_reported"],
							},
						},
						required: ["request_id", "cost", "unit", "usage_source"],
					},
				},
				required: [
					"id",
					"object",
					"created",
					"model",
					"choices",
					"usage",
					"mon2api",
				],
			},
			Error: {
				type: "object",
				properties: {
					error: {
						type: "object",
						properties: {
							code: {
								type: "string",
							},
							message: {
								type: "string",
							},
							details: {},
						},
						required: ["code", "message"],
					},
				},
				required: ["error"],
			},
		},
	},
} as const;
