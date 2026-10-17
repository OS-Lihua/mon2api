import { preflight } from "~/server/security/cors";

export { chatPost as POST } from "~/server/rest/chat";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
