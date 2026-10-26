import { resourcePolicy, resourcesFor, type ResourcePolicy, type Resources } from "@aomi-labs/account/policy";

import type { EdgeEnv } from "../env";
import { config } from "../kernel/config";
import type { FetchLike } from "../kernel/proxy";

/** Everything the portal surface needs per request, resolved once. */
export type PortalContext = {
  env: EdgeEnv;
  /** The public portal origin this request arrived on (its own host). */
  portalOrigin: string;
  /** Where the Vercel portal is reached from the edge (never the public host). */
  upstreamOrigin: string;
  /** Origins whose cookie writes and reads the portal trusts. */
  trustedOrigins: readonly string[];
  resources: Resources;
  dpopRequired: boolean;
  fetchImpl: FetchLike;
  now: () => number;
};

export function isPortalHost(env: EdgeEnv, host: string): boolean {
  return config(env).portal.hosts.has(host.toLowerCase());
}

export function portalContext(
  request: Request,
  env: EdgeEnv,
  fetchImpl: FetchLike,
  now: () => number = Date.now,
): PortalContext | null {
  const url = new URL(request.url);
  const { portal } = config(env);
  if (!portal.hosts.has(url.host.toLowerCase()) || !portal.upstream) return null;
  return {
    env,
    portalOrigin: url.origin,
    upstreamOrigin: portal.upstream,
    trustedOrigins: [...new Set([url.origin, ...portal.trustedOrigins])],
    resources: resourcesFor(url.origin),
    dpopRequired: portal.dpopRequired,
    fetchImpl,
    now,
  };
}

/** The policy of one protected resource this portal origin hosts (an app-locked MCP path included). */
export function policyFor(resource: string, ctx: Pick<PortalContext, "resources" | "dpopRequired">): ResourcePolicy {
  const policy = resourcePolicy(ctx.resources, ctx.dpopRequired, resource);
  if (!policy) throw new Error(`unknown protected resource ${resource}`);
  return policy;
}
