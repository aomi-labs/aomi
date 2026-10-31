// The committed views of the AOMI service mesh, one per signing node and tier:
// public keys only, the private half is each node's secret. The staging, rc and
// production public keys must match the backend's service.{staging,rc,production}.toml
// in product-mono. Generate an edge pair with `pnpm --filter aomi-edge generate-key`.

export type Tier = "default" | "staging" | "rc" | "production";

const HOSTS: Record<string, Tier> = {
  "api.aomi.dev": "production",
  "api-staging.aomi.dev": "staging",
  "api-rc.aomi.dev": "rc",
};

/**
 * Which tier a deployment belongs to: the one it names, else the public API
 * host it serves or signs for, else its Vercel environment, else local.
 */
export function tierOf(input: { tier?: string; host?: string; vercelEnv?: string }): Tier {
  if (input.tier === "default" || input.tier === "staging" || input.tier === "rc" || input.tier === "production")
    return input.tier;
  const byHost = HOSTS[(input.host ?? "").toLowerCase()];
  if (byHost) return byHost;
  if (input.vercelEnv === "production") return "production";
  if (input.vercelEnv === "preview") return "staging";
  return "default";
}

/** The edge (`aomi-edge`): every bearer the Worker sends upstream. */
const EDGE: Record<Tier, string> = {
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
MCowBQYDK2VwAyEAT4QrUywG/+9ZHLHP1ssUH5R4vch7BaTwUkiqTC+atcI=
-----END PUBLIC KEY-----"""

[[services]]
name = "aomi-backend"
kid = "aomi-backend"
issues = []
audiences = []
public_key = ""
`,
  rc: String.raw`# AOMI service topology -- RC (release candidate, RIC1). A separate
# environment beside staging (Beta): its own key, never Beta's. Public key must
# match product-mono's service.rc.toml. Private key lives only in the Worker secret.

[[services]]
name = "aomi-edge"
kid = "aomi-edge-rc-1"
issues = ["user", "service"]
audiences = ["aomi-backend", "aomi-api-server", "aomi-sidecar", "aomi-payment"]
public_key = """
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAMEc3QB7vtWTFxHg1/OGGOtA8U/y1LdAbJHKX26owHlE=
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
kid = "aomi-edge-prod-2"
issues = ["user", "service"]
audiences = ["aomi-backend", "aomi-api-server", "aomi-sidecar", "aomi-payment"]
public_key = """
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAae8coEZrvwByJbaiBV3jEzQd32Tm82bF3mXNRZwttH8=
-----END PUBLIC KEY-----"""

[[services]]
name = "aomi-backend"
kid = "aomi-backend"
issues = []
audiences = []
public_key = ""
`,
};

/** Build's sidecar signer (`aomi-build`); it never runs in rc. */
const BUILD: Partial<Record<Tier, string>> = {
  default: String.raw`# The AOMI service topology -- the portal's committed view of the mesh.
#
# One node per service: its identity (name/kid), SPKI public_key (the private
# half lives in that service's env, never here), the issues roles it may mint,
# and the audiences it may sign for.

[[services]]
name = "aomi-build"
kid = "aomi-build-dev-1"
issues = ["service"]
audiences = ["aomi-sidecar"]
public_key = """
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAcz9wTX8DsJmDChhmt02UIhv9LCceCsJBSlsBgJlExc4=
-----END PUBLIC KEY-----
"""

[[services]]
name = "aomi-admin"
kid = "aomi-admin-dev-1"
issues = ["admin"]
audiences = ["aomi-backend"]
public_key = """
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA+rVh5FCH+iZOESNOhlQYzrFT2yjzllT9kzSZeq1Dg/w=
-----END PUBLIC KEY-----
"""

[[services]]
name = "aomi-backend"
kid = "aomi-backend"
issues = []
audiences = []
public_key = ""
`,
  staging: String.raw`# AOMI service topology -- STAGING. Public keys must match the backend's
# service.staging.toml. Private keys live only in env.

[[services]]
name = "aomi-build"
kid = "aomi-build-staging-1"
issues = ["service"]
audiences = ["aomi-sidecar"]
public_key = """
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAgLSENuOGsWvaeM+7eU6BWSp9tY61HF7Ml4Vv/fxaupY=
-----END PUBLIC KEY-----
"""

[[services]]
name = "aomi-admin"
kid = "aomi-admin-staging-1"
issues = ["admin"]
audiences = ["aomi-backend"]
public_key = """
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA3ceXzJJN8EVzXNhrUREq3JrKUWvWKNj4JpQcS4lNvss=
-----END PUBLIC KEY-----
"""

[[services]]
name = "aomi-backend"
kid = "aomi-backend"
issues = []
audiences = []
public_key = ""
`,
  production: String.raw`# AOMI service topology -- PRODUCTION. Public keys must match the backend's
# service.production.toml. Private keys live only in env.

[[services]]
name = "aomi-build"
kid = "aomi-build-prod-1"
issues = ["service"]
audiences = ["aomi-sidecar"]
public_key = """
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAyaIwzD82igAdhA3xw9Tkr5yJEpaRU3SY73bVqjE7Ajc=
-----END PUBLIC KEY-----
"""

[[services]]
name = "aomi-admin"
kid = "aomi-admin-prod-1"
issues = ["admin"]
audiences = ["aomi-backend"]
public_key = """
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEApsGOtLjeUdfZJYzuwiRz2JegR00bK31s+Q+HHoNdz1s=
-----END PUBLIC KEY-----
"""

[[services]]
name = "aomi-backend"
kid = "aomi-backend"
issues = []
audiences = []
public_key = ""
`,
};

export const TOPOLOGIES = { "aomi-edge": EDGE, "aomi-build": BUILD } as const;

export function topologyFor(self: keyof typeof TOPOLOGIES, tier: Tier): string {
  const toml = TOPOLOGIES[self][tier];
  if (!toml) throw new Error(`${self} has no ${tier} topology`);
  return toml;
}
