import { refundGet, refundPost } from "~/server/rest/commerce";
export async function GET(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	return refundGet(request, (await context.params).id);
}
export async function POST(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	return refundPost(request, (await context.params).id);
}
