import { spawnSync } from "node:child_process";
import {
	chmod,
	copyFile,
	mkdir,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import manifest from "../packages/connector/package.json" with { type: "json" };

const root = fileURLToPath(new URL("../", import.meta.url));
const packageDir = path.join(root, "packages", "connector");

/** Build a self-contained Node CLI and a platform-hosted npm archive. */
export async function buildConnector() {
	await mkdir(path.join(packageDir, "dist"), { recursive: true });
	const outfile = path.join(packageDir, "dist", "connector.mjs");
	await build({
		absWorkingDir: root,
		entryPoints: ["scripts/connector.ts"],
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
		},
		// Preserve third-party notices without publishing source maps or source files.
		legalComments: "eof",
	});
	await chmod(outfile, 0o755);
	await copyFile(path.join(root, "LICENSE"), path.join(packageDir, "LICENSE"));
	/** @type {[string, string][]} */
	const notices = [
		["OpenAI SDK (bundled, unmodified source)", "openai/LICENSE"],
		["OpenAI SDK vendored qs", "openai/src/internal/qs/LICENSE.md"],
		[
			"OpenAI SDK vendored zod-to-json-schema",
			"openai/src/_vendor/zod-to-json-schema/LICENSE",
		],
		["Zod", "zod/LICENSE"],
	];
	const licenses = await Promise.all(
		notices.map(
			async ([label, file]) =>
				`${label}\n\n${await readFile(path.join(root, "node_modules", file), "utf8")}`,
		),
	);
	await writeFile(
		path.join(packageDir, "THIRD_PARTY_LICENSES.txt"),
		licenses.join("\n\n----------------------------------------\n\n"),
	);
	const downloads = path.join(root, "public", "downloads");
	await mkdir(downloads, { recursive: true });
	const packed = spawnSync(
		"npm",
		["pack", packageDir, "--ignore-scripts", "--pack-destination", downloads],
		{ cwd: root, encoding: "utf8" },
	);
	if (packed.error || packed.status !== 0)
		throw new Error(
			packed.error?.message || packed.stderr || "npm pack failed.",
		);
	const archive = path.join(
		downloads,
		`token2api-connector-${manifest.version}.tgz`,
	);
	for (const name of await readdir(downloads)) {
		if (
			/^token2api-connector-\d+\.\d+\.\d+\.tgz$/.test(name) &&
			path.join(downloads, name) !== archive
		)
			await rm(path.join(downloads, name));
	}
	console.log(`Connector package: ${path.relative(root, archive)}`);
	return archive;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	await buildConnector();
