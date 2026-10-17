import { preflight } from "~/server/security/cors";

export { keysGet as GET, keysPost as POST } from "~/server/rest/commerce";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
