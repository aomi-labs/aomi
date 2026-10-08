// @aomi-labs/service — the AOMI service topology: parse the service mesh and
// mint/verify AccountBearers as one node. The TS twin of the Rust `aomi-service`
// crate (one mesh, two vantages). Node-only — it holds EdDSA private keys; never
// bundle into a browser. See
// docs/topics/account-authentication/facts/service-identity.md.

export { AomiService, parseTopology } from "./topology";
export type {
  ServiceNode,
  Topology,
  AccountBearerClaims,
  DelegatedBearerContext,
} from "./topology";
export { assertServerOnly } from "./server-only";
