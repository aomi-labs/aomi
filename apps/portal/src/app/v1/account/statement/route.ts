import {
  applyWidgetCors,
  widgetCorsPreflight,
} from "@portal/server/widget-auth/cors";
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

export function OPTIONS(request: Request): Response {
  return widgetCorsPreflight(request, ["GET", "OPTIONS"]);
}

export async function GET(request: Request): Promise<Response> {
  return applyWidgetCors(request, await handle(request));
}

async function handle(request: Request): Promise<Response> {
  try {
    return await proxyAccountApi(
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
