export type PortalTopologyName = "default" | "staging" | "production";

export const PORTAL_TOPOLOGIES: Record<PortalTopologyName, string> = {
  default: String.raw`# The AOMI service topology -- the portal's committed view of the mesh.
#
# One node per service: its identity (name/kid), SPKI public_key (the private
# half lives in that service's env, never here), the issues roles it may mint,
# and the audiences it may sign for.

[[services]]
name = "aomi-bff"
kid = "aomi-bff-dev-1"
issues = ["user", "service"]
audiences = ["aomi-backend", "aomi-api-server", "aomi-sidecar"]
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
name = "aomi-bff"
kid = "aomi-bff-staging-1"
issues = ["user", "service"]
audiences = ["aomi-backend", "aomi-api-server", "aomi-sidecar"]
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
name = "aomi-bff"
kid = "aomi-bff-prod-1"
issues = ["user", "service"]
audiences = ["aomi-backend", "aomi-api-server", "aomi-sidecar"]
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
