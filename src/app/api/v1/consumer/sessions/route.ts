import { preflight } from "~/server/security/cors";

export {
	consumerSessionsGet as GET,
	consumerSessionsPost as POST,
} from "~/server/rest/commerce";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
