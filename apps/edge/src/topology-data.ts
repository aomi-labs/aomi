import type { EdgeTopologyName } from "./env";

// The edge's committed view of the AOMI service topology: its own node
// (`aomi-edge`) and the services it may address. Public keys only; the private
// half is the EDGE_SERVICE_PRIVATE_KEY secret. The staging and production
// public keys must match the backend's service.{staging,production}.toml in
// product-mono. Generate a pair with `pnpm --filter aomi-edge generate-key`.
export const EDGE_TOPOLOGIES: Record<EdgeTopologyName, string> = {
  default: String.raw`# AOMI service topology -- local development, from the edge's vantage.

[[services]]
name = "aomi-edge"
kid = "aomi-edge-dev-1"
issues = ["user", "service"]
audiences = ["aomi-backend", "aomi-api-server", "aomi-sidecar", "aomi-payment"]
public_key = """
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAuqXC9aHQt49M938ZGYqDBCvqJn6PZP0GzPArcG9eCCw=
-----END PUBLIC KEY-----"""

[[services]]
name = "aomi-backend"
kid = "aomi-backend"
issues = []
audiences = []
public_key = ""
`,
  staging: String.raw`# AOMI service topology -- STAGING. Public key must match the backend's
# service.staging.toml. Private key lives only in the Worker secret.

[[services]]
name = "aomi-edge"
kid = "aomi-edge-staging-1"
issues = ["user", "service"]
audiences = ["aomi-backend", "aomi-api-server", "aomi-sidecar", "aomi-payment"]
public_key = """
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAp2rLxTgOY90OaTgc82S1Y4Olv8y1mDpOuDChxY5f4Vg=
-----END PUBLIC KEY-----"""

[[services]]
name = "aomi-backend"
kid = "aomi-backend"
issues = []
audiences = []
public_key = ""
`,
  production: String.raw`# AOMI service topology -- PRODUCTION. Public key must match the backend's
# service.production.toml. Private key lives only in the Worker secret.

[[services]]
name = "aomi-edge"
kid = "aomi-edge-prod-1"
issues = ["user", "service"]
audiences = ["aomi-backend", "aomi-api-server", "aomi-sidecar", "aomi-payment"]
public_key = """
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAq9ihIZ171b4Qpk0V+vXkr0G2xFkMPFX1rO397+eeZP0=
-----END PUBLIC KEY-----"""

[[services]]
name = "aomi-backend"
kid = "aomi-backend"
issues = []
audiences = []
public_key = ""
`,
};
