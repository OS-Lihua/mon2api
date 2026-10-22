import { keyModelsPost } from "~/server/rest/commerce";
import { preflight } from "~/server/security/cors";

export async function POST(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	return keyModelsPost(request, (await context.params).id);
}
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
