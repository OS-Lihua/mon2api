import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);
it.each(["current", "switch"])(
	"keeps a budget confirmation key within its initiating wallet (%s)",
	async (scenario) => {
		const { stdout } = await execute(process.execPath, [
			"tests/fixtures/console-identity.mjs",
			scenario,
		]);
		expect(stdout).toContain("console identity scenario passed");
	},
);
