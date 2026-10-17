import { merchantStatusPost } from "~/server/rest/commerce";
import { preflight } from "~/server/security/cors";
export async function POST(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	const { id } = await context.params;
	return merchantStatusPost(request, id);
}
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
