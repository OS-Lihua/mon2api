import {
	merchantResourceGet,
	merchantResourcePost,
} from "~/server/rest/commerce";
import { preflight } from "~/server/security/cors";
export async function GET(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	const { id } = await context.params;
	return merchantResourceGet(request, id);
}
export async function POST(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	const { id } = await context.params;
	return merchantResourcePost(request, id);
}
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
