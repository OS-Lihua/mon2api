import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareWebRuntime } from "../scripts/web-runtime.mjs";

const roots: string[] = [];

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "token2api-web-"));
	roots.push(root);
	const standalone = path.join(root, ".next", "standalone");
	fs.mkdirSync(path.join(standalone, "node_modules", ".pnpm", "dependency"), {
		recursive: true,
	});
	fs.writeFileSync(path.join(standalone, "server.js"), "old server");
	fs.writeFileSync(
		path.join(standalone, "node_modules", ".pnpm", "dependency", "index.js"),
		"old dependency",
	);
	fs.symlinkSync(
		".pnpm/dependency",
		path.join(standalone, "node_modules", "dependency"),
		"dir",
	);
	fs.mkdirSync(path.join(root, ".next", "static"), { recursive: true });
	fs.writeFileSync(path.join(root, ".next", "static", "old.css"), "old styles");
	fs.mkdirSync(path.join(root, "public"));
	fs.writeFileSync(path.join(root, "public", "icon.svg"), "old icon");
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

describe("production web build isolation", () => {
	it("keeps server, styles, public files and linked dependencies after a rebuild", () => {
		const root = fixture();
		const runtime = prepareWebRuntime(root);
		// A build deletes standalone output and replaces static assets.
		fs.rmSync(path.join(root, ".next"), { recursive: true });
		fs.writeFileSync(path.join(root, "public", "icon.svg"), "new icon");
		for (const [file, content] of [
			["server.js", "old server"],
			[".next/static/old.css", "old styles"],
			["public/icon.svg", "old icon"],
			["node_modules/dependency/index.js", "old dependency"],
		] as const)
			expect(fs.readFileSync(path.join(runtime, file), "utf8")).toBe(content);
		expect(
			fs.readlinkSync(path.join(runtime, "node_modules", "dependency")),
		).toBe(".pnpm/dependency");
	});

	it("gives each server its own files and removes incomplete runtime copies", () => {
		const root = fixture();
		const first = prepareWebRuntime(root);
		const server = path.join(root, ".next", "standalone", "server.js");
		fs.writeFileSync(server, "new server");
		const second = prepareWebRuntime(root);
		expect(first).not.toBe(second);
		expect(fs.readFileSync(path.join(first, "server.js"), "utf8")).toBe(
			"old server",
		);
		expect(fs.readFileSync(path.join(second, "server.js"), "utf8")).toBe(
			"new server",
		);
		fs.rmSync(path.join(root, ".next", "static"), { recursive: true });
		expect(() => prepareWebRuntime(root)).toThrow();
		expect(fs.readdirSync(path.join(root, ".runtime", "web"))).toHaveLength(2);
	});
});
