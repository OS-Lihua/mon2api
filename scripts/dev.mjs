import { spawn } from "node:child_process";
import { constants } from "node:os";
import { pathToFileURL } from "node:url";

/**
 * @param {{
 *   spawnChild?: (command: string, args: string[], options: import("node:child_process").SpawnOptions) => import("node:child_process").ChildProcess;
 *   runtime?: {
 *     execPath: string;
 *     argv: string[];
 *     exitCode?: string | number;
 *     stdout: Pick<NodeJS.WriteStream, "write">;
 *     stderr: Pick<NodeJS.WriteStream, "write">;
 *     on: (signal: "SIGINT" | "SIGTERM", handler: () => void) => unknown;
 *     removeListener: (signal: "SIGINT" | "SIGTERM", handler: () => void) => unknown;
 *   };
 * }} options
 */
export function startDev({ spawnChild = spawn, runtime = process } = {}) {
	/** @type {Set<import("node:child_process").ChildProcess>} */
	const children = new Set();
	let stopping = false;
	/** @param {number} code */
	function stop(code) {
		if (stopping) return;
		stopping = true;
		runtime.exitCode = code;
		runtime.removeListener("SIGINT", interrupt);
		runtime.removeListener("SIGTERM", terminate);
		for (const child of children) {
			try {
				child.kill("SIGTERM");
			} catch {
				runtime.stderr.write("Failed to terminate a required dev process.\n");
			}
		}
	}
	const interrupt = () => stop(128 + constants.signals.SIGINT);
	const terminate = () => stop(128 + constants.signals.SIGTERM);
	runtime.on("SIGINT", interrupt);
	runtime.on("SIGTERM", terminate);

	/**
	 * @param {string} name
	 * @param {string[]} args
	 * @param {import("node:child_process").SpawnOptions} options
	 */
	function launch(name, args, options) {
		if (stopping) return;
		try {
			const child = spawnChild(runtime.execPath, args, options);
			children.add(child);
			child.on("error", () => {
				runtime.stderr.write(`Required dev process ${name} failed.\n`);
				stop(1);
			});
			child.once("exit", (code, signal) => {
				children.delete(child);
				// Every child is long-lived; an unrequested clean exit is also a failure.
				stop(
					code !== null && code !== 0
						? code
						: signal
							? 128 + constants.signals[signal]
							: 1,
				);
			});
			return child;
		} catch {
			runtime.stderr.write(`Required dev process ${name} could not start.\n`);
			stop(1);
		}
	}

	const chain = launch("chain", ["--import", "tsx", "scripts/chain.ts"], {
		stdio: ["inherit", "pipe", "inherit"],
	});
	const ready = "MON2API_CHAIN_READY";
	let buffered = "";
	let started = false;
	chain?.stdout?.on("data", (data) => {
		runtime.stdout.write(data);
		if (started || stopping) return;
		buffered += data.toString();
		if (!buffered.includes(ready)) {
			buffered = buffered.slice(-(ready.length - 1));
			return;
		}
		started = true;
		const webArgs = runtime.argv.includes("--production")
			? ["scripts/start.mjs"]
			: ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1"];
		launch("web", webArgs, { stdio: "inherit" });
		launch(
			"worker",
			["--conditions=react-server", "--import", "tsx", "scripts/worker.ts"],
			{ stdio: "inherit" },
		);
	});
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	startDev();
}
