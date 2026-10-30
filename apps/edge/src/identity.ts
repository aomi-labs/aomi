import { AomiService } from "@aomi-labs/service-identity";

import type { EdgeEnv, EdgeTopologyName } from "./env";
import { EDGE_TOPOLOGIES } from "./topology-data";

export const EDGE_SERVICE_NAME = "aomi-edge";

/**
 * Which committed topology this deployment mints as. scripts/deploy.mjs always
 * sets EDGE_TOPOLOGY; `wrangler dev` without it is the dev topology.
 */
export function edgeTopologyName(env: EdgeEnv): EdgeTopologyName {
  return env.EDGE_TOPOLOGY ?? "default";
}

const cache = new Map<EdgeTopologyName, AomiService>();

/**
 * The edge as an `AomiService` (self = `aomi-edge`). Every bearer the edge
 * sends upstream is minted here; the Vercel apps mint nothing once the edge
 * is the only issuer.
 */
export function edgeService(env: EdgeEnv): AomiService {
  const name = edgeTopologyName(env);
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
