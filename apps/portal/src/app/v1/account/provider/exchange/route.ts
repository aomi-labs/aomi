import {
  exchangeProviderForExistingSession,
  linkVerifiedProviderIdentityForUser,
} from "@aomi-labs/account/account";
import type { AomiAccountCredential } from "@aomi-labs/account";
import { json } from "@portal/server/account/session";
import { verifyWidgetProviderCredential } from "@portal/server/widget-auth/exchange";
import {
  accountResponseForPrincipal,
  requirePortalPrincipal,
} from "@portal/server/widget-auth/principal";
import { widgetPreflight, widgetRoute } from "@portal/server/widget-auth/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = widgetRoute(async (req: Request) => {
  const principal = await requirePortalPrincipal(req);
  const body = (await req.json().catch(() => null)) as
    | AomiAccountCredential
    | Record<string, unknown>
    | null;
  if (!body) return json(400, { error: "invalid_json" });
  if (principal.kind === "widget") {
    const { descriptor, identity } = await verifyWidgetProviderCredential(body);
    const result = await linkVerifiedProviderIdentityForUser({
      userId: principal.userId,
      identity,
      policy: descriptor.policy,
    });
    if (result.status === "conflict") {
      return json(409, {
        ...result,
        error: "already_linked_to_another_account",
      });
    }
    return Response.json({
      status: "linked",
      account: await accountResponseForPrincipal(req, principal),
    });
  }
  const result = await exchangeProviderForExistingSession({
    betterAuthUserId: principal.betterAuthUserId,
    currentUserId: principal.userId,
    credential: body as AomiAccountCredential,
  });
  if (result.status === "conflict") {
    return json(409, {
      ...result,
      error: "already_linked_to_another_account",
    });
  }
  return Response.json(result);
}, "provider.link");

export const OPTIONS = widgetPreflight(["POST", "OPTIONS"]);
