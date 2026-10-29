import { AomiService } from "@aomi-labs/service-identity";

import type { EdgeEnv, EdgeTopologyName } from "./env";
import { EDGE_TOPOLOGIES } from "./topology-data";

export const EDGE_SERVICE_NAME = "aomi-edge";

const STAGING_HOSTS = new Set(["api-staging.aomi.dev"]);
const RC_HOSTS = new Set(["api-rc.aomi.dev"]);
const PRODUCTION_HOSTS = new Set(["api.aomi.dev"]);

/** Which committed topology this request's deployment mints as. */
export function edgeTopologyName(env: EdgeEnv, host: string): EdgeTopologyName {
  if (env.EDGE_TOPOLOGY) return env.EDGE_TOPOLOGY;
  const lower = host.toLowerCase();
  if (PRODUCTION_HOSTS.has(lower)) return "production";
  if (STAGING_HOSTS.has(lower)) return "staging";
  if (RC_HOSTS.has(lower)) return "rc";
  return "default";
}

const cache = new Map<EdgeTopologyName, AomiService>();

/**
 * The edge as an `AomiService` (self = `aomi-edge`). Every bearer the edge
 * sends upstream is minted here; the Vercel apps mint nothing once the edge
 * is the only issuer.
 */
export function edgeService(env: EdgeEnv, host: string): AomiService {
  const name = edgeTopologyName(env, host);
  const cached = cache.get(name);
  if (cached) return cached;
  const service = AomiService.fromTopology({
    toml: EDGE_TOPOLOGIES[name],
    selfName: EDGE_SERVICE_NAME,
    privateKeyPem: env.EDGE_SERVICE_PRIVATE_KEY,
  });
  cache.set(name, service);
  return service;
}

/** Tests build services against several topologies; drop the memo between them. */
export function resetEdgeServices(): void {
  cache.clear();
}
