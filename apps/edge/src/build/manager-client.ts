import { ManagerClient } from "@aomi-labs/internal";

import { edgeService } from "../identity";
import { mintBearer } from "../portal/errors";
import { UpstreamUnreachableError } from "../portal/forward";
import { rankOrigins, resolvePool, routingKeyFor } from "../routing/pool";
import type { BuildContext } from "./context";
import { BUILD_SERVICE_SUBJECT } from "./manager";

const SERVICE_BEARER_TTL_SECONDS = 5 * 60;

/** Where the manager control plane is reached: the cutover switch, else the backend pool. */
export function managerOrigin(request: Request, ctx: BuildContext): string {
  const manager = (ctx.env.MANAGER_ORIGIN ?? "").trim();
  if (manager) return manager;
  const [origin] = rankOrigins(routingKeyFor(request, new URL(request.url)), resolvePool(ctx.env));
  if (!origin) throw new UpstreamUnreachableError(new Error("no backend origins"));
  return origin;
}

/** The backend the CLI's `sdk fix` hint names; the first origin of the pool. */
export function sdkBackendUrl(ctx: BuildContext): string {
  const [origin] = resolvePool(ctx.env);
  return origin ?? "";
}

/**
 * A manager client for one request, carrying a five-minute `aomi-edge`
 * service bearer. The Build BFF minted the same bearer as `aomi-bff`.
 */
export async function managerClient(request: Request, ctx: BuildContext): Promise<ManagerClient> {
  const { accessToken } = await mintBearer(() =>
    edgeService(ctx.env, new URL(request.url).host).mint({
      role: "service",
      subject: BUILD_SERVICE_SUBJECT,
      audience: "aomi-backend",
      ttlSeconds: SERVICE_BEARER_TTL_SECONDS,
    }),
  );
  return new ManagerClient({
    aomi: { backendUrl: managerOrigin(request, ctx), activationToken: accessToken },
    fetch: (input, init) => ctx.fetchImpl(new Request(input, init), { cache: "no-store" }),
  });
}
