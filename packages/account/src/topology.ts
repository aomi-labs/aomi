import { AomiService, tierOf, topologyFor } from "@aomi-labs/service-identity";

// Build's sidecar signer (`aomi-bff`): the committed topology for the backend
// it serves, with its private key from env (never in the TOML). Server-only:
// `AomiService.fromTopology` throws in a browser bundle.

let cached: AomiService | null = null;

/** The public API host the deployment signs for, from its backend URL. */
function backendHost(env: Record<string, string | undefined>): string | undefined {
  for (const value of [env.BACKEND_URL, env.NEXT_PUBLIC_BACKEND_URL]) {
    try {
      return new URL(value ?? "").hostname;
    } catch {
      // Unset or browser-relative: try the next setting.
    }
  }
  return undefined;
}

/** Build's sidecar signer as an `AomiService` (self = `aomi-bff`), loaded once. */
export function portalService(): AomiService {
  cached ??= AomiService.fromTopology({
    toml: topologyFor("aomi-bff", tierOf({ host: backendHost(process.env), vercelEnv: process.env.VERCEL_ENV })),
    selfName: "aomi-bff",
    privateKeyPem: process.env.PORTAL_SERVICE_PRIVATE_KEY,
  });
  return cached;
}
