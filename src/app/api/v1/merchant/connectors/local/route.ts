import { preflight } from "~/server/security/cors";

export { createConnectorPost as POST } from "~/server/rest/local-connector";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
