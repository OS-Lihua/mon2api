import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildConnector } from "./build-connector.mjs";

// Vercel can restore dependencies without rerunning their install hooks.
const generated = spawnSync(
	process.execPath,
	["node_modules/prisma/build/index.js", "generate"],
	{ stdio: "inherit" },
);
if (generated.status !== 0) process.exit(generated.status || 1);

// Public downloads must exist before Next collects the deployment's static files.
await buildConnector();

// Next can explicitly copy loaded .env files into standalone output. Runtime
// secrets belong to the deployment environment, never the packaged artifact.
const standalone = path.join(process.cwd(), ".next", "standalone");
fs.rmSync(standalone, { recursive: true, force: true });
const result = spawnSync(
	process.execPath,
	["node_modules/next/dist/bin/next", "build"],
	{ stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status || 1);
for (const name of fs.readdirSync(standalone)) {
	if (name === ".env" || name.startsWith(".env."))
		fs.rmSync(path.join(standalone, name), { force: true });
}
