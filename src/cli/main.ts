import { lstat, readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { ConnectorClient, serviceUrl } from "~/connector/client";
import {
	networkResponse,
	okResponse,
	pageResponse,
	resourceResponse,
	viewerResponse,
} from "~/server/services/commerce.schema";
import { withGatewayTransport } from "~/server/services/gateway-transport";
import { connectorCreated } from "~/server/services/local-connector.schema";
import { discoverModels } from "~/server/services/model-discovery";
import { listingUpdateInput } from "~/server/services/token2api.schema";
import { connectorTokenSchema } from "~/shared/connector";
import { type GatewayProxy, proxyInput } from "~/shared/gateway-config";
import { version } from "../../packages/connector/package.json";
import { ManagementClient, privateKeyInput, walletAddress } from "./client";
import {
	CliError,
	commandOptions,
	commands,
	connectionInput,
	privacyRules,
	resourceConfig,
	schemaDocument,
} from "./protocol";
import {
	CliStore,
	decryptSecret,
	encryptSecret,
	readPrivate,
	writePrivate,
} from "./storage";
import {
	manualRequired,
	newPassword,
	type SecretReader,
	terminalSecrets,
} from "./terminal";

const credentialSchema = z
	.object({
		platform: z.string().url(),
		resourceId: z.string().cuid(),
		baseUrl: z.string().url(),
		token: connectorTokenSchema,
		apiKey: z.string().min(1).max(2048),
		proxy: proxyInput.optional(),
	})
	.strict();
const walletSchema = z.object({ privateKey: privateKeyInput }).strict();
const modelConfig = connectionInput.extend({
	transport: z.enum(["local", "direct"]).default("local"),
});
const sensitiveCommand = new Set<string>(
	commands.filter((item) => item.manual).map((item) => item.command),
);

type CliDependencies = {
	fetcher?: typeof fetch;
	readSecret?: SecretReader;
	emit?: (value: unknown) => void;
	signal?: AbortSignal;
};
export function output(value: unknown, pretty = false) {
	const sensitive =
		/^(?:privateKey|apiKey|password|cookie|signature|token|secret|proxySecret|credentials)$/i;
	return JSON.stringify(
		value,
		(key, item: unknown) =>
			sensitive.test(key)
				? "[REDACTED]"
				: typeof item === "string"
					? item.replace(
							/0x[\da-fA-F]{64}\b|(?:t2[acl]_|sk-)[\w-]{16,}/g,
							"[REDACTED]",
						)
					: item,
		pretty ? 2 : undefined,
	);
}
async function publicFile<T extends z.ZodTypeAny>(
	file: string | undefined,
	contract: T,
): Promise<z.infer<T>> {
	if (!file)
		throw new CliError(
			"file_required",
			"请使用 --file 指定仅含公开字段的 JSON 配置。运行 schema 查看字段；不要写入私钥、Key 或密码。",
			2,
		);
	try {
		const stat = await lstat(file);
		if (!stat.isFile() || stat.size > 65536) throw new Error("Invalid file");
		return contract.parse(JSON.parse(await readFile(file, "utf8")));
	} catch {
		throw new CliError(
			"invalid_config",
			"配置文件不存在、格式不符或包含不允许的字段。运行 schema 查看约束；敏感信息须由用户手动输入，不能写进配置。",
			2,
		);
	}
}
async function gatewayCredentials(
	config: z.infer<typeof connectionInput>,
	read: SecretReader,
	direct: boolean,
) {
	const apiKey = z
		.string()
		.min(1)
		.max(2048)
		.parse(
			await read(
				direct
					? "网关调用 Key（将上传到指定平台加密保存）"
					: "本机网关调用 Key（不会上传平台）",
			),
		);
	const proxy: GatewayProxy | undefined = config.proxy
		? proxyInput.parse({
				url: config.proxy.url,
				...(config.proxy.authentication
					? {
							username: await read("代理用户名"),
							password: await read("代理密码"),
						}
					: {}),
			})
		: undefined;
	return { apiKey, proxy };
}

export async function runCli(
	argv: string[],
	dependencies: CliDependencies = {},
): Promise<unknown> {
	let parsed: ReturnType<typeof parseCommand>;
	try {
		parsed = parseCommand(argv);
	} catch (error) {
		if (error instanceof CliError) throw error;
		throw new CliError(
			"invalid_arguments",
			"命令或参数无效。运行 help 查看用法；不接受命令行私钥、密码或 API Key。",
			2,
		);
	}
	const { values, positionals } = parsed;
	const command =
		values.help || !positionals.length ? "help" : positionals.join(" ");
	if (values.version) return { version };
	if (command === "help")
		return {
			version,
			commands,
			privacyRules,
			next: "token2api schema --pretty",
		};
	if (command === "schema") return schemaDocument();
	if (!commands.some((entry) => entry.command === command))
		throw new CliError(
			"unknown_command",
			"未知命令。运行 help 查看命令清单。",
			2,
		);
	const globalOptions = new Set([
		"platform",
		"profile",
		"config-dir",
		"interactive",
		"dry-run",
		"pretty",
		"json",
		"help",
		"version",
	]);
	if (
		Object.keys(values).some(
			(key) =>
				!globalOptions.has(key) &&
				!(commandOptions[command] ?? []).includes(key),
		)
	)
		throw new CliError(
			"invalid_arguments",
			"此命令收到不适用的参数。运行 schema 查看各命令的参数；未执行操作。",
			2,
		);
	if (
		values["dry-run"] &&
		![
			"resource add",
			"resource update",
			"resource pause",
			"resource resume",
			"connector configure",
		].includes(command)
	)
		throw new CliError(
			"unsupported_dry_run",
			"此命令不支持 --dry-run；未执行操作。",
			2,
		);
	const store = new CliStore(values.profile, values["config-dir"]);
	let explicit: string | undefined;
	try {
		explicit = values.platform ? serviceUrl(values.platform) : undefined;
	} catch {
		throw new CliError(
			"invalid_platform",
			"平台须为 HTTPS 根地址；回环地址可使用 HTTP，不含路径、凭证、查询或片段。",
			2,
		);
	}
	const publicArgs = [
		...(explicit ? ["--platform", explicit] : []),
		...(values.profile ? ["--profile", values.profile] : []),
		...(values["config-dir"] ? ["--config-dir", values["config-dir"]] : []),
		...(values.file ? ["--file", values.file] : []),
		...(values.id ? ["--id", values.id] : []),
		...(values["key-file"] ? ["--key-file", values["key-file"]] : []),
	];
	const read =
		dependencies.readSecret ??
		terminalSecrets(!!values.interactive, command, publicArgs);
	const needsManual = () => {
		if (
			!dependencies.readSecret &&
			(!values.interactive || !process.stdin.isTTY)
		)
			manualRequired(command, publicArgs, "私钥、密码或网关调用凭证");
	};
	const id = () => {
		const result = z.string().cuid().safeParse(values.id);
		if (!result.success)
			throw new CliError("invalid_id", "请使用 --id 指定有效资源 ID。", 2);
		return result.data;
	};
	// Validate the public plan before handing secret entry to the user.
	if ((commandOptions[command] ?? []).includes("id")) id();
	if (command === "resource add") await publicFile(values.file, resourceConfig);
	if (command === "gateway models") await publicFile(values.file, modelConfig);
	if (command === "connector configure")
		await publicFile(values.file, connectionInput);
	if (sensitiveCommand.has(command) && !values["dry-run"]) needsManual();
	if (command === "auth import") {
		const file = values["key-file"] ?? store.file("wallet.json");
		try {
			await lstat(file);
			throw new CliError(
				"wallet_exists",
				"密钥文件已存在，拒绝覆盖。请指定新的 --key-file 路径。",
				5,
			);
		} catch (error) {
			if (error instanceof CliError) throw error;
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				throw error;
		}
		const privateKey = privateKeyInput.parse(
			await read("钱包私钥（仅本地加密保存）"),
		);
		const address = walletAddress(privateKey);
		const password = await newPassword(read);
		await writePrivate(file, encryptSecret({ privateKey }, password, "wallet"));
		return { saved: true, encrypted: true, keyFile: file, address };
	}
	if (command === "auth logout") {
		let remoteConfirmed = false;
		try {
			const logoutPlatform = serviceUrl(await store.platform(explicit));
			const session = await store.session(logoutPlatform);
			await new ManagementClient(
				logoutPlatform,
				session,
				dependencies.fetcher,
			).request("POST", "/auth/logout", okResponse, {});
			remoteConfirmed = true;
		} catch {
			/* Local logout must still work offline or after session expiration. */
		}
		await store.logout();
		return { loggedOut: true, remoteConfirmed };
	}
	const platform = serviceUrl(await store.platform(explicit));
	const anonymous = new ManagementClient(
		platform,
		undefined,
		dependencies.fetcher,
	);
	if (command === "doctor") {
		const network = (await anonymous.network()).data;
		let signedIn = false;
		try {
			await store.session(platform);
			signedIn = true;
		} catch {
			/* No credential contents are returned. */
		}
		return {
			platform,
			network,
			localSessionPresent: signedIn,
			configDirectory: store.directory,
			privacyRules,
		};
	}
	if (command === "auth login") {
		const network = networkResponse.parse((await anonymous.network()).data);
		if (!network.ready)
			throw new CliError(
				"platform_unready",
				"平台结算网络尚未就绪，未请求私钥。",
				7,
			);
		process.stderr.write(
			`登录目标：${platform} · chain ${network.chainId}。签名仅用于登录，不授权转账。\n`,
		);
		const file = values["key-file"] ?? store.file("wallet.json");
		let exists = true;
		try {
			await lstat(file);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				exists = false;
			else throw error;
		}
		if (values["key-file"] && !exists)
			throw new CliError(
				"key_file_missing",
				"指定的加密密钥文件不存在。请用户本人检查，不要将私钥放进参数。",
				2,
			);
		const key = exists
			? walletSchema.parse(
					decryptSecret(
						await readPrivate(file),
						await read("加密密钥文件密码"),
						"wallet",
					),
				).privateKey
			: privateKeyInput.parse(await read("钱包私钥（仅本次签名使用，不保存）"));
		const signed = await anonymous.login(key, network.chainId);
		await writePrivate(store.file("session.json"), signed.session);
		await store.rememberPlatform(platform);
		return {
			platform,
			address: signed.viewer.address,
			expiresAt: new Date(signed.session.expiresAt).toISOString(),
			privateKeyPersistedByThisLogin: false,
			next: "token2api resource list",
		};
	}
	if (command === "connector start") {
		const resourceId = id();
		const context = `connector:${platform}:${resourceId}`;
		let encrypted: unknown;
		try {
			encrypted = await readPrivate(store.file(`connector-${resourceId}.json`));
		} catch (error) {
			if (error instanceof CliError) throw error;
			throw new CliError(
				"connector_not_configured",
				"缺少本机加密配置。请用户本人运行 connector configure --id <资源 ID> --file <公开配置> --interactive。",
				6,
			);
		}
		const credentials = credentialSchema.parse(
			decryptSecret(encrypted, await read("连接器凭证文件密码"), context),
		);
		if (
			credentials.platform !== platform ||
			credentials.resourceId !== resourceId
		)
			throw new CliError(
				"platform_mismatch",
				"连接器配置不属于此平台或资源。",
				4,
			);
		const client = new ConnectorClient(
			platform,
			credentials.token,
			dependencies.fetcher,
		);
		const state = await client.status();
		if (state.listingId !== resourceId)
			throw new CliError("resource_mismatch", "连接器凭证不属于指定资源。", 4);
		const controller = new AbortController();
		const stop = () => controller.abort();
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
		const signal = dependencies.signal
			? AbortSignal.any([controller.signal, dependencies.signal])
			: controller.signal;
		try {
			dependencies.emit?.({ event: "connector_started", resourceId, platform });
			await withGatewayTransport(credentials.proxy, (fetcher) =>
				client.run({
					upstream: credentials.baseUrl,
					apiKey: credentials.apiKey,
					signal,
					upstreamFetcher: fetcher,
					log: (message) =>
						dependencies.emit?.({
							event: "connector_status",
							resourceId,
							message,
						}),
				}),
			);
		} finally {
			process.off("SIGINT", stop);
			process.off("SIGTERM", stop);
		}
		return { event: "connector_stopped", resourceId };
	}
	if (values["dry-run"]) {
		if (command === "resource add") {
			const config = await publicFile(values.file, resourceConfig);
			return {
				dryRun: true,
				command,
				platform,
				config,
				pricingUnit: "micro-units per million tokens",
				requiresManualInput: true,
				automaticRetry: false,
			};
		}
		if (command === "connector configure")
			return {
				dryRun: true,
				command,
				resourceId: id(),
				platform,
				config: await publicFile(values.file, connectionInput),
				rotatesCredential: true,
				requiresManualInput: true,
				automaticRetry: false,
			};
		return {
			dryRun: true,
			command,
			platform,
			resourceId: id(),
			...(command === "resource update"
				? { changes: await publicFile(values.file, listingUpdateInput) }
				: { enabled: command === "resource resume" }),
			automaticRetry: false,
		};
	}
	const session = await store.session(platform);
	const client = new ManagementClient(platform, session, dependencies.fetcher);
	if (command === "auth status")
		return {
			...(await client.request("GET", "/auth/me", viewerResponse)).data,
			platform,
			expiresAt: new Date(session.expiresAt).toISOString(),
		};
	if (command === "resource list") {
		const limit = z.coerce
			.number()
			.int()
			.min(1)
			.max(100)
			.parse(values.limit ?? "20");
		const query = new URLSearchParams({ limit: String(limit) });
		if (values.cursor)
			query.set("cursor", z.string().cuid().parse(values.cursor));
		return (
			await client.request(
				"GET",
				`/merchant/resources?${query}`,
				pageResponse(resourceResponse),
			)
		).data;
	}
	if (command === "resource get" || command === "connector status")
		return (
			await client.request(
				"GET",
				`/merchant/resources/${id()}`,
				resourceResponse,
			)
		).data;
	if (
		["resource pause", "resource resume", "resource update"].includes(command)
	)
		return (
			await client.request(
				"POST",
				`/merchant/resources/${id()}${command === "resource update" ? "" : "/status"}`,
				okResponse,
				command === "resource update"
					? await publicFile(values.file, listingUpdateInput)
					: { enabled: command === "resource resume" },
			)
		).data;
	await client.request("GET", "/auth/me", viewerResponse);
	if (command === "gateway models") {
		const config = await publicFile(values.file, modelConfig);
		const credentials = await gatewayCredentials(
			config,
			read,
			config.transport === "direct",
		);
		if (config.transport === "direct")
			return (
				await client.request(
					"POST",
					"/merchant/connectors/discover",
					z.object({ models: z.array(z.string()) }).strict(),
					{ baseUrl: config.baseUrl, ...credentials },
				)
			).data;
		return {
			models: await withGatewayTransport(credentials.proxy, (fetcher) =>
				discoverModels(config.baseUrl, credentials.apiKey, fetcher),
			),
		};
	}
	if (command === "resource add") {
		const config = await publicFile(values.file, resourceConfig);
		const local = config.transport === "local";
		process.stderr.write(
			`目标平台：${platform}；${local ? "本机连接器，网关 Key 留在本地" : "平台直连，网关 Key 和代理认证信息将上传到此平台加密保存"}。\n`,
		);
		const credentials = await gatewayCredentials(config, read, !local);
		const models = local
			? await withGatewayTransport(credentials.proxy, (fetcher) =>
					discoverModels(config.baseUrl, credentials.apiKey, fetcher),
				)
			: (
					await client.request(
						"POST",
						"/merchant/connectors/discover",
						z.object({ models: z.array(z.string()) }).strict(),
						{ baseUrl: config.baseUrl, ...credentials },
					)
				).data.models;
		if (!models.includes(config.model))
			throw new CliError(
				"model_unavailable",
				"配置模型不在网关返回的列表中；未创建资源。",
				2,
			);
		const common = {
			name: config.name,
			description: config.description,
			kind: "gateway",
			model: config.model,
			inputRate: config.inputRate,
			outputRate: config.outputRate,
			concurrency: config.concurrency,
		};
		if (!local)
			return {
				...(
					await client.request(
						"POST",
						"/merchant/resources",
						z.object({ id: z.string().cuid() }).strict(),
						{ ...common, baseUrl: config.baseUrl, ...credentials },
					)
				).data,
				transport: "direct",
			};
		const password = await newPassword(read);
		await store.rememberPlatform(platform);
		const created = (
			await client.request(
				"POST",
				"/merchant/connectors/local",
				connectorCreated,
				common,
			)
		).data;
		try {
			await writePrivate(
				store.file(`connector-${created.id}.json`),
				encryptSecret(
					{
						platform,
						resourceId: created.id,
						baseUrl: config.baseUrl,
						...credentials,
						token: created.token,
					},
					password,
					`connector:${platform}:${created.id}`,
				),
			);
		} catch {
			throw new CliError(
				"credential_save_failed",
				"资源已创建，但本地凭证未能保存。不要重复创建；请用户本人运行 connector configure 恢复。",
				6,
				{ resourceId: created.id },
			);
		}
		return {
			id: created.id,
			transport: "local",
			online: false,
			credentialSaved: true,
			next: [
				"token2api",
				"connector",
				"start",
				"--id",
				created.id,
				"--interactive",
			],
		};
	}
	if (command === "connector configure") {
		const resourceId = id();
		const resource = (
			await client.request(
				"GET",
				`/merchant/resources/${resourceId}`,
				resourceResponse,
			)
		).data;
		if (resource.transport !== "local")
			throw new CliError("not_local", "此资源不是本机连接器。", 2);
		const config = await publicFile(values.file, connectionInput);
		const credentials = await gatewayCredentials(config, read, false);
		const password = await newPassword(read);
		const models = await withGatewayTransport(credentials.proxy, (fetcher) =>
			discoverModels(config.baseUrl, credentials.apiKey, fetcher),
		);
		if (!models.includes(resource.model))
			throw new CliError(
				"model_unavailable",
				"网关不提供资源固定模型；未轮换凭证。",
				2,
			);
		const created = (
			await client.request(
				"POST",
				"/merchant/connectors/rotate",
				connectorCreated,
				{ id: resourceId },
			)
		).data;
		try {
			await writePrivate(
				store.file(`connector-${resourceId}.json`),
				encryptSecret(
					{
						platform,
						resourceId,
						baseUrl: config.baseUrl,
						...credentials,
						token: created.token,
					},
					password,
					`connector:${platform}:${resourceId}`,
				),
			);
		} catch {
			throw new CliError(
				"credential_save_failed",
				"凭证已轮换，但本地保存失败。旧连接器已失效，请用户本人重新配置；不要让 AI 获取凭证。",
				6,
				{ resourceId },
			);
		}
		return {
			id: resourceId,
			credentialSaved: true,
			previousCredentialRevoked: true,
		};
	}
	throw new CliError("unknown_command", "未知命令。", 2);
}

function parseCommand(args: string[]) {
	return parseArgs({
		args,
		allowPositionals: true,
		strict: true,
		options: {
			platform: { type: "string" },
			profile: { type: "string" },
			"config-dir": { type: "string" },
			"key-file": { type: "string" },
			file: { type: "string" },
			id: { type: "string" },
			limit: { type: "string" },
			cursor: { type: "string" },
			interactive: { type: "boolean" },
			"dry-run": { type: "boolean" },
			pretty: { type: "boolean" },
			json: { type: "boolean" },
			help: { type: "boolean" },
			version: { type: "boolean" },
		},
	});
}

export async function main(args = process.argv.slice(2)) {
	const pretty = args.includes("--pretty");
	const emit = (data: unknown) =>
		process.stdout.write(
			`${output({ schemaVersion: 1, ok: true, data }, pretty)}\n`,
		);
	try {
		emit(await runCli(args, { emit }));
	} catch (failure) {
		const error =
			failure instanceof CliError
				? failure
				: new CliError(
						"invalid_input",
						"操作未完成。请核对公开配置和服务状态；不要打印凭证或将隐私信息提供给 AI。",
						2,
					);
		process.stdout.write(
			`${output({ schemaVersion: 1, ok: false, error: { code: error.code, message: error.message, ...error.details } }, pretty)}\n`,
		);
		process.exitCode = error.exitCode;
	}
}
