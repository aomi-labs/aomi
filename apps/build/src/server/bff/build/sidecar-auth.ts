import "@tanstack/react-start/server-only";

import { AomiService, tierOf, topologyFor } from "@aomi-labs/service-identity";
import { buildFailures } from "@/server/bff/failures";

// Build's sidecar signer (`aomi-bff`): the committed topology for the backend
// it serves, with its private key from env (never in the TOML).
let cached: AomiService | null = null;

/** The public API host the deployment signs for, from its backend URL. */
function backendHost(
  env: Record<string, string | undefined>,
): string | undefined {
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
function bffService(): AomiService {
  cached ??= AomiService.fromTopology({
    toml: topologyFor(
      "aomi-bff",
      tierOf({
        host: backendHost(process.env),
        vercelEnv: process.env.VERCEL_ENV,
      }),
    ),
    selfName: "aomi-bff",
    privateKeyPem: process.env.PORTAL_SERVICE_PRIVATE_KEY,
  });
  return cached;
}

/**
 * Sidecar auth rides the official service-bearer path (the same
 * PORTAL_SERVICE_PRIVATE_KEY + committed-topology signing that backend
 * bearers use): the BFF mints a short-lived EdDSA JWT per
 * proxied request, and the in-VM sidecar verifies it against aomi-bff's
 * committed *public* key, which is safe to ship into a sandbox that runs
 * agent-generated code. No shared secret is stored anywhere — not in the
 * registry, not in the VM env.
 *
 * The audience is "aomi-sidecar", never "aomi-backend", so a bearer that
 * leaks out of the VM is useless against the backend (its verifier rejects
 * the audience); `sub` pins the bearer to one run id, which the sidecar
 * checks against its own AOMI_SIDECAR_RUN_ID.
 */
export const SIDECAR_AUDIENCE = "aomi-sidecar";

const SIDECAR_BEARER_TTL_SECONDS = 5 * 60;

/** Fresh bearer for one run's sidecar — minted per request, never stored. */
export async function mintSidecarBearer(runId: string): Promise<string> {
  const { accessToken } = await bffService().mint({
    role: "service",
    subject: runId,
    audience: SIDECAR_AUDIENCE,
    ttlSeconds: SIDECAR_BEARER_TTL_SECONDS,
  });
  return accessToken;
}

/**
 * aomi-bff's committed SPKI public key — the sidecar's verification anchor,
 * passed into the sandbox env at dispatch. Empty string when the topology is
 * unavailable; the sidecar then fails closed (rejects every request).
 */
export function sidecarVerifierPublicKeyPem(): string {
  try {
    return bffService().self.publicKey;
  } catch (error) {
    buildFailures.handle({
      source: "local",
      error,
      context: {
        routeFamily: "/api/build",
        operation: "build.sidecar_verifier_config",
      },
    });
    return "";
  }
}
