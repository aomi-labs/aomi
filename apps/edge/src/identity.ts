import { AomiService, tierOf, topologyFor, type Tier } from "@aomi-labs/service-identity";

import type { EdgeEnv } from "./env";

export const EDGE_SERVICE_NAME = "aomi-edge";

/** Which committed topology this request's deployment mints as. */
export function edgeTopologyName(env: EdgeEnv, host: string): Tier {
  return tierOf({ tier: env.EDGE_TOPOLOGY, host });
}

const cache = new Map<Tier, AomiService>();

/**
 * The edge as an `AomiService` (self = `aomi-edge`). Every bearer the edge
 * sends upstream is minted here; the apps mint nothing.
 */
export function edgeService(env: EdgeEnv, host: string): AomiService {
  const name = edgeTopologyName(env, host);
  const cached = cache.get(name);
  if (cached) return cached;
  const service = AomiService.fromTopology({
    toml: topologyFor(EDGE_SERVICE_NAME, name),
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
