import { ManagerClient } from "@aomi-labs/internal";

import { edgeService, EDGE_SERVICE_NAME } from "../identity";
import { config } from "../kernel/config";
import { minted, unreachable } from "../kernel/errors";
import { apiOrigins } from "../kernel/manager";
import { target } from "../kernel/proxy";
import type { BuildContext } from "./context";

const SERVICE_BEARER_TTL_SECONDS = 5 * 60;

/** Resolve the actual endpoint: manager control plane or backend-owned vault. */
export function apiOrigin(request: Request, ctx: BuildContext, pathname: string): string {
  const [origin] = apiOrigins(request, ctx.env, pathname);
  if (!origin) throw unreachable(new Error("no manager or backend origin"));
  return origin;
}

/** The backend the CLI's `sdk fix` hint names; the first origin of the pool. */
export function sdkBackendUrl(ctx: BuildContext): string {
  return config(ctx.env).pool[0] ?? "";
}

/** A manager client for one request, carrying a five-minute `aomi-edge` service bearer. */
export async function managerClient(request: Request, ctx: BuildContext): Promise<ManagerClient> {
  const { accessToken } = await minted(() =>
    edgeService(ctx.env, new URL(request.url).host).mint({
      role: "service",
      subject: EDGE_SERVICE_NAME,
      audience: "aomi-backend",
      ttlSeconds: SERVICE_BEARER_TTL_SECONDS,
    }),
  );
  return new ManagerClient({
    // The client assembles paths here; its fetch adapter selects their upstream.
    url: ctx.buildOrigin,
    bearer: accessToken,
    fetch: (input, init) => {
      // The service bearer must never follow a redirect to another host.
      const outgoing = new Request(input, { ...init, redirect: "manual" });
      const url = new URL(outgoing.url);
      const upstream = target(apiOrigin(request, ctx, url.pathname), url.pathname, url.search);
      return ctx.fetchImpl(new Request(upstream, outgoing), { cache: "no-store" });
    },
  });
}
