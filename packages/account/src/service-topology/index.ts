// Compatibility entry point. The topology engine lives in
// `@aomi-labs/service-identity` so the Cloudflare edge can mint bearers without
// the Node-only account package. Import from there in new code.
export {
  AomiService,
  parseTopology,
  assertServerOnly,
} from "@aomi-labs/service-identity";
export type {
  ServiceNode,
  Topology,
  AccountBearerClaims,
  DelegatedBearerContext,
} from "@aomi-labs/service-identity";
