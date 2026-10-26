import { issuePrincipalToken } from "@/server/edge/principal-token";
export const POST = issuePrincipalToken;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
