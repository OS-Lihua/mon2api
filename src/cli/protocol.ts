import {
	extendZodWithOpenApi,
	OpenAPIRegistry,
	OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { listingUpdateInput } from "~/server/services/token2api.schema";
import {
	endpointUrl,
	proxyAuthenticationAllowed,
	proxyInput,
} from "~/shared/gateway-config";

extendZodWithOpenApi(z);

export class CliError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly exitCode = 1,
		public readonly details: Record<string, unknown> = {},
	) {
		super(message);
	}
}

export const connectionInput = z
	.object({
		baseUrl: z
			.string()
			.url()
			.max(2048)
			.describe("HTTPS API 基础地址；只有回环地址允许 HTTP，裸域名使用 /v1。")
			.transform((value) => endpointUrl(value, "GATEWAY")),
		proxy: proxyInput
			.innerType()
			.omit({ username: true, password: true })
			.extend({ authentication: z.boolean().default(false) })
			.refine(
				(value) =>
					!value.authentication || proxyAuthenticationAllowed(value.url),
				{
					message: "带认证的远程代理必须使用 HTTPS；HTTP 认证仅允许回环地址。",
				},
			)
			.optional(),
	})
	.strict();
export const resourceConfig = connectionInput
	.extend({
		transport: z.enum(["local", "direct"]),
		name: z.string().min(2).max(64),
		description: z.string().min(2).max(300),
		model: z.string().regex(/^[\w./:@-]{1,100}$/),
		inputRate: z.number().int().min(1).max(1_000_000_000),
		outputRate: z.number().int().min(1).max(1_000_000_000),
		concurrency: z.number().int().min(1).max(20).default(1),
	})
	.strict()
	.refine(
		(config) => config.transport !== "local" || config.concurrency === 1,
		{ message: "本机连接器仅支持并发 1。" },
	);

export const commands = [
	{
		command: "help",
		summary: "查看命令清单和隐私规则",
		mutation: false,
		manual: false,
	},
	{
		command: "schema",
		summary: "获取配置文件 JSON Schema、退出码及 AI 操作规则",
		mutation: false,
		manual: false,
	},
	{
		command: "doctor",
		summary: "检查平台网络和本地配置，不读取私钥",
		mutation: false,
		manual: false,
	},
	{
		command: "auth import",
		summary: "由用户手动导入私钥，保存为本地加密密钥文件",
		mutation: true,
		manual: true,
	},
	{
		command: "auth login",
		summary: "用户在本地签名登录；私钥不上传、不打印",
		mutation: true,
		manual: true,
	},
	{
		command: "auth status",
		summary: "查看当前登录钱包和会话有效期",
		mutation: false,
		manual: false,
	},
	{
		command: "auth logout",
		summary: "退出管理会话，不删除连接器加密配置",
		mutation: true,
		manual: false,
	},
	{
		command: "gateway models",
		summary: "由用户手动输入调用 Key，读取模型列表；需 --file",
		mutation: false,
		manual: true,
	},
	{
		command: "resource add",
		summary: "按 --file 创建资源；支持 --dry-run，敏感字段由用户输入",
		mutation: true,
		manual: true,
	},
	{
		command: "resource list",
		summary: "分页列出自己的资源；支持 --limit、--cursor",
		mutation: false,
		manual: false,
	},
	{
		command: "resource get",
		summary: "查询自己的资源；需 --id",
		mutation: false,
		manual: false,
	},
	{
		command: "resource update",
		summary: "更新名称、报价、并发等；需 --id、--file，支持 --dry-run",
		mutation: true,
		manual: false,
	},
	{
		command: "resource pause",
		summary: "暂停自己的资源；需 --id，支持 --dry-run",
		mutation: true,
		manual: false,
	},
	{
		command: "resource resume",
		summary: "重新上架自己的资源；需 --id，仍受白名单限制，支持 --dry-run",
		mutation: true,
		manual: false,
	},
	{
		command: "connector configure",
		summary:
			"轮换本机连接器凭证并保存加密配置；需 --id、--file，支持 --dry-run",
		mutation: true,
		manual: true,
	},
	{
		command: "connector start",
		summary: "用户手动解锁本机连接器配置并接单；需 --id",
		mutation: true,
		manual: true,
	},
	{
		command: "connector status",
		summary: "通过管理会话查看资源连接状态；需 --id",
		mutation: false,
		manual: false,
	},
] as const;

export const commandOptions: Record<string, readonly string[]> = {
	"auth import": ["key-file"],
	"auth login": ["key-file"],
	"gateway models": ["file"],
	"resource add": ["file"],
	"resource list": ["limit", "cursor"],
	"resource get": ["id"],
	"resource update": ["id", "file"],
	"resource pause": ["id"],
	"resource resume": ["id"],
	"connector configure": ["id", "file"],
	"connector start": ["id"],
	"connector status": ["id"],
};

export const privacyRules = [
	"私钥、密码、API Key 和会话凭证由用户本人在自己的终端输入；AI 不得索取、读取、代填或打印。",
	"遇到退出码 6 或 manual_input_required 时停止敏感操作，提醒用户运行返回的 manualCommand；不要改用 PTY、stdin、环境变量或参数代填。",
	"配置 JSON 只允许公开字段，不得写入任何私钥、Key、密码或 Cookie。",
	"登录私钥只用于本地签名；本机网关 Key 不上传；平台直连会将调用 Key 和代理认证信息上传到指定平台加密保存。",
	"写操作不自动重试。outcome_unknown 表示可能已成功，先查询资源，禁止直接重复创建或轮换凭证。",
	"本 CLI 不自动执行转账、提现或其他资金交易。",
];
export const exitCodes = {
	success: 0,
	error: 1,
	invalid_input: 2,
	authentication_required: 3,
	forbidden: 4,
	conflict: 5,
	manual_input_required: 6,
	unavailable: 7,
	cancelled: 130,
};

export function schemaDocument() {
	const registry = new OpenAPIRegistry();
	registry.register("ResourceConfig", resourceConfig);
	registry.register("ResourceChanges", listingUpdateInput);
	registry.register(
		"ConnectionConfig",
		connectionInput.extend({
			transport: z.enum(["local", "direct"]).default("local"),
		}),
	);
	const doc = new OpenApiGeneratorV31(registry.definitions).generateDocument({
		openapi: "3.1.0",
		info: { title: "Token2API CLI", version: "1" },
	});
	return {
		commands: commands.map((entry) => ({
			...entry,
			options: commandOptions[entry.command] ?? [],
			automaticRetry: false,
		})),
		exitCodes,
		privacyRules,
		globalOptions: [
			"--platform <https-origin>",
			"--profile <name>",
			"--config-dir <path>",
			"--interactive",
			"--dry-run",
			"--pretty",
			"--json",
		],
		schemas: doc.components?.schemas,
		components: doc.components,
		pricing:
			"inputRate/outputRate 是当前结算资产的整数百万分之一 / 百万 Token。先用 doctor 核对资产。",
		output:
			"普通命令输出单个 JSON；connector start 输出 NDJSON 事件。stdout 永不包含凭证。",
	};
}
