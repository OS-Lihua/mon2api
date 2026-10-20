import { ChildProcess, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { startDev } from "../scripts/dev.mjs";

function setup(production = false) {
	// ChildProcess is only an EventEmitter until spawn() is called. Never spawn here.
	const children = Array.from({ length: 3 }, () => {
		const child = new ChildProcess();
		child.stdout = new PassThrough();
		vi.spyOn(child, "kill").mockReturnValue(true);
		return child;
	});
	const [chain, web, worker] = children;
	if (!chain || !web || !worker) throw new Error("Missing fake child");
	const spawnChild =
		vi.fn<
			(command: string, args: string[], options: SpawnOptions) => ChildProcess
		>();
	for (const child of children) spawnChild.mockReturnValueOnce(child);
	const environment: NodeJS.ProcessEnv = {
		TOKEN2API_MODE: "local",
		NODE_ENV: "test",
	};
	const runtime = Object.assign(new EventEmitter(), {
		execPath: "/fake/node",
		argv: [
			"/fake/node",
			"/fake/dev.mjs",
			...(production ? ["--production"] : []),
		],
		exitCode: undefined as number | string | undefined,
		env: environment,
		stdout: { write: vi.fn((_data: unknown) => true) },
		stderr: { write: vi.fn(() => true) },
	});
	const start = () => startDev({ spawnChild, runtime });
	const ready = () =>
		chain.stdout?.emit("data", Buffer.from("TOKEN2API_CHAIN_READY\n"));
	return { children, chain, web, worker, spawnChild, runtime, start, ready };
}

describe("dev process supervision with isolated fake children", () => {
	it.each([undefined, "evm"])(
		"starts web and worker without a local chain when mode is %s",
		(mode) => {
			const { start, spawnChild, runtime, children } = setup();
			runtime.env.TOKEN2API_MODE = mode;
			start();
			expect(spawnChild.mock.calls.map((call) => call[1])).toEqual([
				["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1"],
				["--conditions=react-server", "--import", "tsx", "scripts/worker.ts"],
			]);
			children[1]?.emit("exit", 23, null);
			expect(runtime.exitCode).toBe(23);
			expect(children[0]?.kill).toHaveBeenCalledWith("SIGTERM");
		},
	);
	it("rejects an unsupported network before starting processes", () => {
		const { start, spawnChild, runtime } = setup();
		runtime.env.TOKEN2API_MODE = "mainnet";
		expect(start).toThrow("TOKEN2API_MODE must be");
		expect(spawnChild).not.toHaveBeenCalled();
	});
	it("waits for readiness across arbitrary stdout chunks and starts dependents once", () => {
		const { chain, spawnChild, runtime, start, ready } = setup();
		start();
		expect(spawnChild).toHaveBeenCalledTimes(1);
		const chunks = ["booting\nTOKEN2", "API_CHAIN_", "REA", "DY\n"];
		for (const text of chunks) chain.stdout?.emit("data", Buffer.from(text));
		expect(spawnChild).toHaveBeenCalledTimes(3);
		expect(spawnChild.mock.calls[1]?.[1]).toEqual([
			"node_modules/next/dist/bin/next",
			"dev",
			"--hostname",
			"127.0.0.1",
		]);
		expect(spawnChild.mock.calls[2]?.[1]).toEqual([
			"--conditions=react-server",
			"--import",
			"tsx",
			"scripts/worker.ts",
		]);
		expect(
			runtime.stdout.write.mock.calls.map(([data]) => String(data)).join(""),
		).toBe(chunks.join(""));
		ready();
		expect(spawnChild).toHaveBeenCalledTimes(3);
	});

	it("uses the production launcher when requested", () => {
		const { start, ready, spawnChild } = setup(true);
		start();
		ready();
		expect(spawnChild.mock.calls[1]?.[1]).toEqual(["scripts/start.mjs"]);
	});

	it.each([0, 1, 2])(
		"handles an error from required child %i and terminates all children",
		(index) => {
			const { children, runtime, start, ready } = setup();
			start();
			ready();
			children[index]?.emit("error", new Error("fake spawn failure"));
			expect(runtime.exitCode).toBe(1);
			for (const child of children)
				expect(child.kill).toHaveBeenCalledWith("SIGTERM");
			// Later exits from shutdown must not replace the original failure.
			for (const child of children) child.emit("exit", null, "SIGTERM");
			expect(runtime.exitCode).toBe(1);
		},
	);

	it.each([0, 1, 2])(
		"propagates a failure from required child %i and stops siblings",
		(index) => {
			const { children, runtime, start, ready } = setup();
			start();
			ready();
			children[index]?.emit("exit", 23, null);
			expect(runtime.exitCode).toBe(23);
			children.forEach((child, childIndex) => {
				if (childIndex !== index)
					expect(child.kill).toHaveBeenCalledWith("SIGTERM");
			});
			for (const child of children) child.emit("exit", 0, null);
			expect(runtime.exitCode).toBe(23);
		},
	);

	it.each([0, 1, 2])(
		"treats an unexpected clean exit from child %i as failure",
		(index) => {
			const { children, runtime, start, ready } = setup();
			start();
			ready();
			children[index]?.emit("exit", 0, null);
			expect(runtime.exitCode).toBe(1);
		},
	);

	it.each(["SIGTERM", "SIGINT", "SIGKILL"] as const)(
		"propagates a child's %s exit",
		(signal) => {
			const { worker, web, runtime, start, ready } = setup();
			start();
			ready();
			worker.emit("exit", null, signal);
			expect(runtime.exitCode).toBe(
				{ SIGTERM: 143, SIGINT: 130, SIGKILL: 137 }[signal],
			);
			expect(web.kill).toHaveBeenCalledWith("SIGTERM");
		},
	);

	it.each(["SIGTERM", "SIGINT"] as const)(
		"forwards parent %s and keeps its exit code",
		(signal) => {
			const { children, runtime, start, ready } = setup();
			start();
			ready();
			runtime.emit(signal);
			for (const child of children) {
				expect(child.kill).toHaveBeenCalledOnce();
				expect(child.kill).toHaveBeenCalledWith("SIGTERM");
				child.emit("exit", 0, null);
			}
			expect(runtime.exitCode).toBe(signal === "SIGTERM" ? 143 : 130);
			expect(runtime.listenerCount("SIGTERM")).toBe(0);
			expect(runtime.listenerCount("SIGINT")).toBe(0);
		},
	);

	it.each(["signal", "error", "exit"])(
		"does not launch dependents if %s happens before readiness",
		(kind) => {
			const { chain, runtime, start, ready, spawnChild } = setup();
			start();
			if (kind === "signal") runtime.emit("SIGTERM");
			else if (kind === "error") chain.emit("error", new Error("fake error"));
			else chain.emit("exit", 7, null);
			ready();
			expect(spawnChild).toHaveBeenCalledTimes(1);
			expect(runtime.exitCode).toBe(
				kind === "signal" ? 143 : kind === "exit" ? 7 : 1,
			);
		},
	);

	it("cleans up when spawn throws synchronously and prevents later launches", () => {
		const { chain, spawnChild, runtime, start, ready } = setup();
		spawnChild
			.mockReset()
			.mockReturnValueOnce(chain)
			.mockImplementationOnce(() => {
				throw new Error("fake spawn failure");
			});
		start();
		ready();
		expect(runtime.exitCode).toBe(1);
		expect(chain.kill).toHaveBeenCalledWith("SIGTERM");
		expect(spawnChild).toHaveBeenCalledTimes(2);
	});
});
