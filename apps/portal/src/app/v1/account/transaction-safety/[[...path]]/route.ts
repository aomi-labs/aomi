import {
  applyWidgetCors,
  widgetCorsPreflight,
} from "@portal/server/widget-auth/cors";
import { proxyAccountApi } from "@portal/server/account-api-proxy";
import { transactionSafetyScope } from "@portal/server/transaction-safety-policy";
import {
  apiAuthError,
  resolveApiPrincipal,
  type ApiPrincipal,
} from "@portal/server/oauth/principal";
import {
  ACCOUNT_SCOPES,
  aomiOAuthResources,
} from "@portal/server/oauth/resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: Request): Response {
  return widgetCorsPreflight(request, ["GET", "PUT", "OPTIONS"]);
}

async function handle(request: Request): Promise<Response> {
  const scope = transactionSafetyScope(
    request.method,
    new URL(request.url).pathname,
  );
  if (!scope)
    return applyWidgetCors(
      request,
      Response.json(
        { error: { code: "not_found", message: "Not found" } },
        { status: 404 },
      ),
    );
  const resource = aomiOAuthResources().accountRest;
  let principal: ApiPrincipal;
  try {
    principal = await resolveApiPrincipal({
      request,
      resource,
      requiredScopes: [scope],
      sessionScopes: ACCOUNT_SCOPES,
    });
  } catch (error) {
    return applyWidgetCors(request, apiAuthError(error, resource));
  }
  return applyWidgetCors(request, await proxyAccountApi(request, principal));
}

export const GET = handle;
export const PUT = handle;
