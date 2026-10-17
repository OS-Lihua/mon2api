import "dotenv/config";
import { z } from "zod";
import { db } from "../src/server/db";
import { resolveReview } from "../src/server/services/review";

const args = z
	.tuple([
		z.string().cuid(),
		z.coerce.number().int().nonnegative().safe(),
		z.coerce.number().int().nonnegative().safe(),
		z.string().min(1).max(160),
	])
	.parse(process.argv.slice(2));
try {
	console.log(await resolveReview(...args));
} finally {
	await db.$disconnect();
}
