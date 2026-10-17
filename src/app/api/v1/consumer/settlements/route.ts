import { preflight } from "~/server/security/cors";

export { consumerSettlementsGet as GET } from "~/server/rest/commerce";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
