import "dotenv/config";
import { db } from "../src/server/db";
import { processSettlementQueue } from "../src/server/services/settlement";

let stopping = false;
process.on("SIGTERM", () => {
	stopping = true;
});
process.on("SIGINT", () => {
	stopping = true;
});
console.log("Token2API settlement worker: every 10 seconds.");
while (!stopping) {
	try {
		const results = await processSettlementQueue();
		for (const r of results)
			console.log(JSON.stringify({ worker: "settlement", ...r }));
	} catch {
		console.error(
			"Settlement worker could not reach database/chain; will retry.",
		);
	}
	if (!stopping) await new Promise((resolve) => setTimeout(resolve, 10_000));
}
await db.$disconnect();
