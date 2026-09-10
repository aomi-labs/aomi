import { json } from "@portal/server/account/session";
import {
  deactivateAomiAccount,
  updateAccountProfile,
} from "@aomi-labs/account/account";
import { auth } from "@aomi-labs/account/better-auth";
import { revokeWidgetSession } from "@aomi-labs/account/widget-auth";
import {
  accountResponseForPrincipal,
  requirePortalPrincipal,
  resolvePortalPrincipal,
} from "@portal/server/widget-auth/principal";
import {
  widgetPreflight,
  widgetRoute,
} from "@portal/server/widget-auth/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = widgetRoute(async (req: Request) => {
  const principal = await resolvePortalPrincipal(req);
  const body =
    principal.kind === "anonymous" ||
    (principal.kind === "better_auth" && principal.isAnonymous)
      ? {
          guest: principal.kind === "better_auth",
          user: null,
          linkedAccounts: [],
          wallets: [],
          session: null,
        }
      : await accountResponseForPrincipal(req, principal);
  return Response.json(body);
}, "account.read");

export const PATCH = widgetRoute(async (req: Request) => {
  const principal = await requirePortalPrincipal(req);
  const body = (await req.json().catch(() => null)) as {
    displayName?: string | null;
    avatarUrl?: string | null;
  } | null;
  if (!body) return json(400, { error: "invalid_json" });
  await updateAccountProfile({
    userId: principal.userId,
    displayName: body.displayName,
    avatarUrl: body.avatarUrl,
  });
  return Response.json(await accountResponseForPrincipal(req, principal));
}, "account.update");

export const DELETE = widgetRoute(async (req: Request) => {
  const principal = await requirePortalPrincipal(req);
  const result = await deactivateAomiAccount({ userId: principal.userId });
  if (result.status === "not_found") {
    return json(404, { error: "account_not_found" });
  }
  if (principal.kind === "widget") {
    await revokeWidgetSession({ request: req });
    return Response.json(result);
  }
  const url = new URL(req.url);
  url.pathname = "/api/auth/sign-out";
  url.search = "";
  const signOutResponse = await auth.handler(
    new Request(url, { method: "POST", headers: req.headers }),
  );
  return Response.json(result, { headers: signOutResponse.headers });
}, "account.delete");

export const OPTIONS = widgetPreflight(["GET", "PATCH", "DELETE", "OPTIONS"]);
