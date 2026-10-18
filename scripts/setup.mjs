import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";

if (!fs.existsSync(".env")) {
	const env = fs
		.readFileSync(".env.example", "utf8")
		.replace(
			'SESSION_PASSWORD=""',
			`SESSION_PASSWORD="${randomBytes(48).toString("base64url")}"`,
		);
	fs.writeFileSync(".env", env, { mode: 0o600 });
	console.log("Created local .env with a random session password.");
}
for (const [command, args] of [
	["docker", ["compose", "up", "-d", "--wait", "postgres"]],
	["pnpm", ["exec", "prisma", "generate"]],
	["pnpm", ["db:migrate"]],
	["pnpm", ["db:seed"]],
]) {
	const result = spawnSync(command, args, { stdio: "inherit" });
	if (result.status !== 0) process.exit(result.status || 1);
}
console.log(
	"Database ready. Configure EVM network contracts with pnpm deploy:evm, then run pnpm dev for the settlement worker and web console. See docs/deployment/vercel.md.",
);
