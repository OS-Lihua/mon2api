import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
if (!fs.existsSync(path.join(standalone, "server.js")))
	throw new Error("Run pnpm build first.");
fs.cpSync(
	path.join(root, ".next", "static"),
	path.join(standalone, ".next", "static"),
	{ recursive: true },
);
if (fs.existsSync(path.join(root, "public")))
	fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), {
		recursive: true,
	});
const server = spawn(process.execPath, [path.join(standalone, "server.js")], {
	stdio: "inherit",
	env: {
		...process.env,
		HOSTNAME: "127.0.0.1",
		PORT: process.env.PORT || "3000",
		MON2API_DATA_DIR: path.resolve(process.env.MON2API_DATA_DIR || ".runtime"),
	},
});
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => {
		server.kill(signal);
	});
server.on("exit", (code) => {
	process.exitCode = code || 0;
});
