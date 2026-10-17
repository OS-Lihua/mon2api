import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { mnemonicToAccount } from "viem/accounts";

const prisma = new PrismaClient();
const mnemonic = "test test test test test test test test test test test junk";
async function main() {
	if (
		process.env.ALLOW_DEMO !== "true" ||
		process.env.MON2API_MODE !== "local"
	) {
		console.log("Demo seed disabled.");
		return;
	}
	const names = ["Northstar Pool", "Orbit Compute", "Community Node"];
	for (let i = 0; i < names.length; i++) {
		const name = names[i];
		if (!name) continue;
		const id = `cmon2apidemo00000000000000${i + 1}`;
		await prisma.listing.upsert({
			where: { id },
			update: {},
			create: {
				id,
				owner: mnemonicToAccount(mnemonic, {
					addressIndex: i + 1,
				}).address.toLowerCase(),
				name,
				description:
					[
						"独立连接器 · 文本调用演示资源",
						"小型资源池 · 按用量计费演示",
						"社区供应者 · 完整结算演示",
					][i] || "Demo resource",
				model: "mon2api-demo",
				kind: "demo",
				inputRate: [3000000, 2000000, 1500000][i] || 3000000,
				outputRate: [15000000, 10000000, 8000000][i] || 15000000,
				concurrency: 2,
			},
		});
	}
	console.log(
		"Seeded three clearly labelled demo resources; no historical usage fabricated.",
	);
}
main().finally(() => prisma.$disconnect());
