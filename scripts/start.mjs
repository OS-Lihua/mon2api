import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { prepareWebRuntime } from "./web-runtime.mjs";

const root = process.cwd();
const runtime = prepareWebRuntime(root);
const server = spawn(process.execPath, [path.join(runtime, "server.js")], {
	stdio: "inherit",
	env: {
		...process.env,
		HOSTNAME: "127.0.0.1",
		PORT: process.env.PORT || "3000",
		TOKEN2API_DATA_DIR: path.resolve(
			process.env.TOKEN2API_DATA_DIR ||
				(process.env.TOKEN2API_MODE === "local"
					? ".runtime"
					: `.runtime/evm/${process.env.SETTLEMENT_CHAIN_ID || "1"}-${(process.env.SETTLEMENT_ASSET || "ETH").toLowerCase()}`),
		),
	},
});
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => {
		server.kill(signal);
	});
server.on("error", (error) => {
	console.error(error.message);
	fs.rmSync(runtime, { recursive: true, force: true });
	process.exitCode = 1;
});
server.on("exit", (code, signal) => {
	fs.rmSync(runtime, { recursive: true, force: true });
	process.exitCode = code ?? (signal ? 1 : 0);
});
