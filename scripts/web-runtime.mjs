import fs from "node:fs";
import path from "node:path";

/** Copy one complete build so later builds cannot replace a running server's files.
 * @param {string} root
 */
export function prepareWebRuntime(root) {
	const standalone = path.join(root, ".next", "standalone");
	if (!fs.existsSync(path.join(standalone, "server.js")))
		throw new Error("Run pnpm build first.");
	const runtimeRoot = path.join(root, ".runtime", "web");
	fs.mkdirSync(runtimeRoot, { recursive: true });
	const runtime = fs.mkdtempSync(path.join(runtimeRoot, "release-"));
	try {
		// Keep pnpm's relative links inside this copy, away from mutable .next files.
		const options = { recursive: true, verbatimSymlinks: true };
		fs.cpSync(standalone, runtime, options);
		fs.cpSync(
			path.join(root, ".next", "static"),
			path.join(runtime, ".next", "static"),
			options,
		);
		if (fs.existsSync(path.join(root, "public")))
			fs.cpSync(
				path.join(root, "public"),
				path.join(runtime, "public"),
				options,
			);
		return runtime;
	} catch (error) {
		fs.rmSync(runtime, { recursive: true, force: true });
		throw error;
	}
}
