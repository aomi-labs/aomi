import { ManagerClient } from "@aomi-labs/internal";

import { edgeService, EDGE_SERVICE_NAME } from "../identity";
import { config } from "../kernel/config";
import { minted, unreachable } from "../kernel/errors";
import { apiOrigins } from "../kernel/manager";
import type { BuildContext } from "./context";

const SERVICE_BEARER_TTL_SECONDS = 5 * 60;

/** Any manager-owned path: every manager client call resolves where the manager is. */
const MANAGER_PROBE_PATH = "/api/manager/openapi.json";

/** Where the manager control plane is reached: the cutover switch, else the backend pool. */
export function managerOrigin(request: Request, ctx: BuildContext): string {
  const [origin] = apiOrigins(request, ctx.env, MANAGER_PROBE_PATH);
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
    url: managerOrigin(request, ctx),
    bearer: accessToken,
    fetch: (input, init) => ctx.fetchImpl(new Request(input, init), { cache: "no-store" }),
  });
}
