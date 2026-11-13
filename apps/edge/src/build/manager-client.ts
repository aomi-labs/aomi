import { ManagerClient } from "@aomi-labs/internal";

import { edgeService, EDGE_SERVICE_NAME } from "../identity";
import { config } from "../kernel/config";
import { EdgeError, minted, unreachable } from "../kernel/errors";
import { apiOrigins, isManagerPath } from "../kernel/manager";
import { target } from "../kernel/proxy";
import { carriesApiKey } from "./api-keys";
import type { Caller } from "./auth";
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

/**
 * The bearer a caller's manager calls carry. A session or CLI caller is the
 * edge acting for a signed-in builder: the `aomi-edge` service bearer. A key
 * caller is the builder itself, limited to the key's capabilities, which the
 * manager enforces per route.
 */
function mintBearer(ctx: BuildContext, key: Caller["key"]) {
  const service = edgeService(ctx.env);
  const audience = "aomi-backend";
  const ttlSeconds = SERVICE_BEARER_TTL_SECONDS;
  if (!key) return service.mint({ role: "service", subject: EDGE_SERVICE_NAME, audience, ttlSeconds });
  // The manager reads a scope only with its resource, so a key without
  // capabilities carries neither and reaches the `builder:read` routes alone.
  const scope = key.capabilities.join(" ");
  return service.mint({
    role: "user",
    subject: key.builderId,
    audience,
    ttlSeconds,
    delegated: {
      auth_source: "api_key",
      principal_class: "builder",
      ...(scope ? { scope, resource: `${ctx.buildOrigin}/api/build` } : {}),
    },
  });
}

/**
 * A manager client for one request, carrying a five-minute bearer: the
 * `aomi-edge` service bearer, or for a key caller the builder's own. A request
 * presenting an API key never gets the service bearer, and its builder bearer
 * goes to manager routes only.
 */
export async function managerClient(request: Request, ctx: BuildContext, caller?: Caller): Promise<ManagerClient> {
  const key = caller?.key;
  if (!key && carriesApiKey(request)) throw new EdgeError(403, "api_key_not_allowed");
  const { accessToken } = await minted(() => mintBearer(ctx, key));
  return new ManagerClient({
    // The client assembles paths here; its fetch adapter selects their upstream.
    url: ctx.buildOrigin,
    bearer: accessToken,
    fetch: (input, init) => {
      // The bearer must never follow a redirect to another host.
      const outgoing = new Request(input, { ...init, redirect: "manual" });
      const url = new URL(outgoing.url);
      // Answered here as the upstream would, so the client reports an ordinary 403.
      if (key && !isManagerPath(url.pathname))
        return Promise.resolve(Response.json({ error: "api_key_not_allowed" }, { status: 403 }));
      const upstream = target(apiOrigin(request, ctx, url.pathname), url.pathname, url.search);
      return ctx.fetchImpl(new Request(upstream, outgoing), { cache: "no-store" });
    },
  });
}
