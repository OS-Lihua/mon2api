import { spawn } from "node:child_process";

const children = [];
let stopping = false;
function stop() {
	if (stopping) return;
	stopping = true;
	children.forEach((p) => {
		p.kill("SIGTERM");
	});
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
const chain = spawn(process.execPath, ["--import", "tsx", "scripts/chain.ts"], {
	stdio: ["inherit", "pipe", "inherit"],
});
children.push(chain);
let started = false;
chain.stdout.on("data", (data) => {
	process.stdout.write(data);
	if (!started && data.toString().includes("MON2API_CHAIN_READY")) {
		started = true;
		const webArgs = process.argv.includes("--production")
			? ["scripts/start.mjs"]
			: ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1"];
		const web = spawn(process.execPath, webArgs, { stdio: "inherit" });
		children.push(web);
		const worker = spawn(
			process.execPath,
			["--conditions=react-server", "--import", "tsx", "scripts/worker.ts"],
			{ stdio: "inherit" },
		);
		children.push(worker);
		web.on("exit", (code) => {
			stop();
			process.exitCode = code || 0;
		});
	}
});
chain.on("exit", (code) => {
	stop();
	process.exitCode = code || 0;
});
