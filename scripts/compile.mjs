import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

export function compile() {
	const sources = Object.fromEntries(
		["DemoUSD", "UsageEscrow", "NativeUsageEscrow"].map((name) => [
			`${name}.sol`,
			{ content: fs.readFileSync(`contracts/src/${name}.sol`, "utf8") },
		]),
	);
	const output = JSON.parse(
		solc.compile(
			JSON.stringify({
				language: "Solidity",
				sources,
				settings: {
					optimizer: { enabled: true, runs: 200 },
					evmVersion: "shanghai",
					outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
				},
			}),
			{
				import: (name) => {
					try {
						return {
							contents: fs.readFileSync(
								path.join("node_modules", name),
								"utf8",
							),
						};
					} catch {
						return { error: `Import not found: ${name}` };
					}
				},
			},
		),
	);
	const errors = (output.errors || []).filter((e) => e.severity === "error");
	if (errors.length)
		throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
	fs.mkdirSync("contracts/artifacts", { recursive: true });
	const artifacts = {};
	for (const name of ["DemoUSD", "UsageEscrow", "NativeUsageEscrow"]) {
		const c = output.contracts[`${name}.sol`][name];
		artifacts[name] = { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
		fs.writeFileSync(
			`contracts/artifacts/${name}.json`,
			JSON.stringify(artifacts[name], null, 2),
		);
	}
	return artifacts;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	compile();
	console.log("Compiled legacy ERC20 and native MON escrows (Shanghai EVM).");
}
