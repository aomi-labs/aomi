import {
  renameAuthIdentity,
  unlinkAuthIdentity,
} from "@aomi-labs/account/account";
import { json } from "@portal/server/account/session";
import {
  accountResponseForPrincipal,
  requirePortalPrincipal,
} from "@portal/server/widget-auth/principal";
import { widgetPreflight, widgetRoute } from "@portal/server/widget-auth/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = widgetRoute(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const current = await requirePortalPrincipal(req);
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as {
      displayLabel?: string | null;
    } | null;
    if (!body || !("displayLabel" in body)) {
      return json(400, { error: "display_label_required" });
    }
    const result = await renameAuthIdentity({
      userId: current.userId,
      identityId: id,
      displayLabel: body.displayLabel ?? null,
    });
    if (result === "not_found")
      return json(404, { error: "identity_not_found" });
    if (result === "protected")
      return json(403, { error: "protected_identity" });
    return Response.json(await accountResponseForPrincipal(req, current));
  },
  "identity.rename",
);

export const DELETE = widgetRoute(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const current = await requirePortalPrincipal(req);
    const { id } = await ctx.params;
    const result = await unlinkAuthIdentity({
      userId: current.userId,
      identityId: id,
    });
    if (result === "not_found")
      return json(404, { error: "identity_not_found" });
    if (result === "protected")
      return json(403, { error: "protected_identity" });
    if (result === "last_factor") {
      return json(409, { error: "cannot_unlink_last_login_factor" });
    }
    return Response.json({ status: "revoked" });
  },
  "identity.unlink",
);

export const OPTIONS = widgetPreflight(["PATCH", "DELETE", "OPTIONS"]);
