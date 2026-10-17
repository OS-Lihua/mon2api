import { preflight } from "~/server/security/cors";

export { modelsGet as GET } from "~/server/rest/chat";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
