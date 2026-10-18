import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { version } from "../packages/connector/package.json";
import { ConnectorClient, serviceUrl } from "../src/connector/client";
import {
	connectorLaunchCode,
	connectorTokenSchema,
} from "../src/shared/connector";

class ConnectorLaunchError extends Error {}

async function secret(label: string): Promise<string> {
	if (!process.stdin.isTTY)
		throw new Error(
			"请设置凭证环境变量，或使用 --credentials-stdin 提供凭证 JSON。",
		);
	const input = process.stdin;
	const wasRaw = input.isRaw;
	input.setRawMode(true);
	input.resume();
	process.stderr.write(`${label}: `);
	return new Promise((resolve, reject) => {
		let value = "";
		const done = () => {
			input.off("data", onData);
			input.setRawMode(wasRaw);
			input.pause();
			process.stderr.write("\n");
		};
		const onData = (chunk: Buffer) => {
			for (const char of chunk.toString("utf8")) {
				if (char === "\r" || char === "\n") {
					done();
					resolve(value);
					return;
				}
				if (char === "\u0003") {
					done();
					reject(new Error("已取消。"));
					return;
				}
				if (char === "\u007f") {
					value = value.slice(0, -1);
					continue;
				}
				if (char >= " ") value += char;
			}
		};
		input.on("data", onData);
	});
}
async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			platform: { type: "string" },
			upstream: { type: "string" },
			model: { type: "string" },
			"credentials-stdin": { type: "boolean" },
			"connect-code": { type: "string" },
			help: { type: "boolean" },
			version: { type: "boolean" },
		},
	});
	if (values.version) {
		console.log(version);
		return;
	}
	const command = positionals[0] ?? "help";
	if (values.help || command === "help") {
		console.log(
			'Token2API 本机连接器\n\ntoken2api-connector start --platform <平台地址> --upstream <本机上游 /v1 地址>\ntoken2api-connector status --platform <平台地址>\ntoken2api-connector --version\n\n需要 Node.js 24 或更高版本。从平台网页复制 npx 启动命令，可在任意目录运行，无需下载项目源码。\n自动读取上游 /v1/models，再回到网页选择模型和报价。Magpie 的默认上游为 http://127.0.0.1:3425/v1。\n网页“复制并启动”提供 --connect-code，一次性启动码 5 分钟内有效，自动兑换平台凭证，无需再次粘贴。\n手动连接器凭证与上游 Key 使用隐藏输入，或 MON2API_CONNECTOR_TOKEN / MON2API_UPSTREAM_KEY。\n后台服务可使用 --credentials-stdin 从标准输入读取 {"token":"...","apiKey":"..."}；不接受命令行密钥。\n上游 Key 不会上传平台。保持进程在线以接单；Ctrl+C 停止。仅支持文本 Chat Completions。旧资源可用 --model <模型 ID> 保持原有固定模型模式。 ',
		);
		return;
	}
	if (!["start", "status"].includes(command) || positionals.length !== 1)
		throw new Error("未知命令；运行 token2api-connector --help 查看用法。");
	if (!values.platform) throw new Error("缺少 --platform。");
	const platform = serviceUrl(values.platform);
	if (command === "start" && !values.upstream)
		throw new Error("缺少 --upstream。");
	const upstream = values.upstream
		? serviceUrl(values.upstream, true)
		: undefined;
	const credentials = values["credentials-stdin"]
		? z
				.object({
					token: connectorTokenSchema,
					apiKey: z.string().min(1).max(2048).optional(),
				})
				.strict()
				.parse(JSON.parse(readFileSync(0, "utf8")))
		: undefined;
	const token = connectorTokenSchema.parse(
		values["connect-code"]
			? await ConnectorClient.connect(
					platform,
					connectorLaunchCode.parse(values["connect-code"]),
				).catch(() => {
					throw new ConnectorLaunchError();
				})
			: credentials?.token ||
					process.env.MON2API_CONNECTOR_TOKEN ||
					(await secret("平台连接器凭证")),
	);
	const client = new ConnectorClient(platform, token);
	if (command === "status") {
		console.log(JSON.stringify(await client.status(), null, 2));
		return;
	}
	if (!upstream) throw new Error("缺少 --upstream。");
	const apiKey = z
		.string()
		.min(1)
		.max(2048)
		.parse(
			credentials?.apiKey ||
				process.env.MON2API_UPSTREAM_KEY ||
				(await secret("本机上游 API Key")),
		);
	const stopping = new AbortController();
	process.once("SIGINT", () => stopping.abort());
	process.once("SIGTERM", () => stopping.abort());
	console.log("Token2API 本机连接器已启动。Key 仅用于本机上游；等待平台任务。");
	await client.run({
		model: values.model,
		upstream,
		apiKey,
		signal: stopping.signal,
		log: (message) => console.log(message),
	});
}
main().catch((error) => {
	console.error(
		error instanceof ConnectorLaunchError
			? "启动连接未完成。请检查网络，回到网页重新复制启动命令。启动码只能使用一次，且在 5 分钟后过期。"
			: "连接器未能完成操作。请检查命令、平台地址、模型及凭证；密钥不会写入日志。运行 token2api-connector --help 查看用法。",
	);
	process.exitCode = 1;
});
