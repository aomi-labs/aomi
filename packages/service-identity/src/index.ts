// @aomi-labs/service-identity — the AOMI service topology: parse the service
// mesh and mint/verify AccountBearers as one node. The TS twin of the Rust
// `aomi-service` crate (one mesh, two vantages). Runtime-agnostic: it needs
// only WebCrypto through `jose`, so it runs in Node and in Cloudflare Workers.
// It holds EdDSA private keys at runtime; never bundle it into a browser. See
// docs/topics/account-authentication/facts/service-identity.md.

export { AomiService, parseTopology, assertServerOnly } from "./topology";
export type {
  ServiceNode,
  Topology,
  AccountBearerClaims,
  DelegatedBearerContext,
} from "./topology";
