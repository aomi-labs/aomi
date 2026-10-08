import { bffPrivateKey } from "./fake-backend/upstream";

/**
 * Environment for a Portal under browser test: real Better Auth on the given
 * database, every backend call sent to the fake upstream, and the embed
 * origins allowed to use the Portal's auth.
 */
export function portalEnv(input: {
  portal: string;
  upstream: string;
  databaseUrl: string;
  embedOrigins: string[];
}): Record<string, string> {
  return {
    BETTER_AUTH_URL: input.portal,
    BETTER_AUTH_SECRET: "browser-test-secret-at-least-32-bytes-long",
    AOMI_PORTAL_BASE_URL: input.portal,
    AOMI_AUTH_DOMAIN: new URL(input.portal).host,
    AOMI_TRUSTED_ORIGINS: [input.portal, ...input.embedOrigins].join(","),
    DATABASE_URL: input.databaseUrl,
    PORTAL_SERVICE_PRIVATE_KEY: bffPrivateKey,
    NEXT_PUBLIC_BACKEND_URL: "/",
    AOMI_PROXY_BACKEND_URL: input.upstream,
    AOMI_AGENT_API_URL: input.upstream,
    NEXT_PUBLIC_PROJECT_ID: "000000000000000000000000000000000000000000",
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
      "000000000000000000000000000000000000000000",
    NEXT_PUBLIC_PARA_API_KEY: "ci-fixture-not-a-secret",
    NEXT_PUBLIC_PARA_ENVIRONMENT: "BETA",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
