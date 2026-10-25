import type { EdgeEnv } from "../env";
import type { FetchLike } from "../routing/upstream";
import { resourcesFor, type Resources } from "./policy";

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

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Hosts the edge serves as the portal surface (routed on their /api and /v1). */
export function portalHosts(env: EdgeEnv): string[] {
  return csv(env.PORTAL_HOSTS).map((host) => host.toLowerCase());
}

export function isPortalHost(env: EdgeEnv, host: string): boolean {
  return portalHosts(env).includes(host.toLowerCase());
}

export function portalContext(
  request: Request,
  env: EdgeEnv,
  fetchImpl: FetchLike,
  now: () => number = Date.now,
): PortalContext | null {
  const url = new URL(request.url);
  if (!isPortalHost(env, url.host)) return null;
  const upstreamOrigin = (env.PORTAL_UPSTREAM_ORIGIN ?? "").trim().replace(/\/+$/, "");
  if (!upstreamOrigin) return null;
  const portalOrigin = url.origin;
  return {
    env,
    portalOrigin,
    upstreamOrigin,
    trustedOrigins: [...new Set([portalOrigin, ...csv(env.PORTAL_TRUSTED_ORIGINS)])],
    resources: resourcesFor(portalOrigin),
    dpopRequired: (env.AOMI_MCP_DPOP_REQUIRED ?? "").trim().toLowerCase() === "true",
    fetchImpl,
    now,
  };
}
