import { renameWallet, unlinkWallet } from "@aomi-labs/account/account";
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
      label?: string | null;
    } | null;
    if (!body || !("label" in body))
      return json(400, { error: "label_required" });
    const ok = await renameWallet({
      userId: current.userId,
      walletId: id,
      label: body.label ?? null,
    });
    if (!ok) return json(404, { error: "wallet_not_found" });
    return Response.json(await accountResponseForPrincipal(req, current));
  },
  "wallet.rename",
);

export const DELETE = widgetRoute(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const current = await requirePortalPrincipal(req);
    const { id } = await ctx.params;
    const result = await unlinkWallet({
      userId: current.userId,
      walletId: id,
      betterAuthUserId:
        current.kind === "better_auth" ? current.betterAuthUserId : null,
    });
    if (result === "not_found") return json(404, { error: "wallet_not_found" });
    if (result === "last_factor") {
      return json(409, { error: "cannot_unlink_last_login_factor" });
    }
    return Response.json({ status: "revoked" });
  },
  "wallet.unlink",
);

export const OPTIONS = widgetPreflight(["PATCH", "DELETE", "OPTIONS"]);
