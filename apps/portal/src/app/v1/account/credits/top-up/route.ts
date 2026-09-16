import { proxyAccountApi } from "@portal/server/account-api-proxy";
import {
  ApiPrincipalError,
  resolveApiPrincipal,
} from "@portal/server/oauth/principal";
import {
  ACCOUNT_SCOPES,
  aomiOAuthResources,
} from "@portal/server/oauth/resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const requiredScopes = ["account:credits:topup"];
    if (request.headers.has("payment-signature"))
      requiredScopes.push("payments:submit");
    return proxyAccountApi(
      request,
      await resolveApiPrincipal({
        request,
        resource: aomiOAuthResources().accountRest,
        requiredScopes,
        sessionScopes: ACCOUNT_SCOPES,
      }),
    );
  } catch (error) {
    const status = error instanceof ApiPrincipalError ? error.status : 401;
    return Response.json(
      { error: { code: "unauthorized", message: "Credit top-up failed" } },
      { status },
    );
  }
}
