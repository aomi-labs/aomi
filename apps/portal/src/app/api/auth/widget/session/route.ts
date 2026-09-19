import { revokeWidgetSession } from "@aomi-labs/account/widget-auth";
import { widgetPreflight, widgetRoute } from "@portal/server/widget-auth/response";

export const DELETE = widgetRoute(async (request: Request) => {
  const revoked = await revokeWidgetSession({ request });
  return revoked
    ? new Response(null, { status: 204 })
    : Response.json({ error: "invalid_widget_session" }, { status: 401 });
}, "widget.session.revoke");

export const OPTIONS = widgetPreflight(["DELETE", "OPTIONS"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
