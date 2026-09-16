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

export async function GET(request: Request): Promise<Response> {
  try {
    return proxyAccountApi(
      request,
      await resolveApiPrincipal({
        request,
        resource: aomiOAuthResources().accountRest,
        requiredScopes: ["account:usage:read"],
        sessionScopes: ACCOUNT_SCOPES,
      }),
    );
  } catch (error) {
    const status = error instanceof ApiPrincipalError ? error.status : 401;
    return Response.json(
      {
        error: {
          code: "unauthorized",
          message: "Account statement request failed",
        },
      },
      { status },
    );
  }
}
