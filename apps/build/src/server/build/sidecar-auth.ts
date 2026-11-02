import "@tanstack/react-start/server-only";

import { AomiService, tierOf, topologyFor } from "@aomi-labs/service-identity";
import { buildFailures } from "@/server/failures";

// Build's sidecar signer (`aomi-build`): the committed topology for the backend
// it serves, with its private key from env (never in the TOML).
let cached: AomiService | null = null;

/** The public API host the deployment signs for, from its backend URL. */
function backendHost(
  env: Record<string, string | undefined>,
): string | undefined {
  try {
    return new URL(env.BACKEND_URL ?? "").hostname;
  } catch {
    return undefined;
  }
}

/** Build's sidecar signer as an `AomiService` (self = `aomi-build`), loaded once. */
function buildService(): AomiService {
  cached ??= AomiService.fromTopology({
    toml: topologyFor(
      "aomi-build",
      tierOf({
        host: backendHost(process.env),
        vercelEnv: process.env.VERCEL_ENV,
      }),
    ),
    selfName: "aomi-build",
    privateKeyPem: process.env.BUILD_SERVICE_PRIVATE_KEY,
  });
  return cached;
}

/**
 * Sidecar auth rides the official service-bearer path (the same
 * BUILD_SERVICE_PRIVATE_KEY + committed-topology signing that backend
 * bearers use): the Build server mints a short-lived EdDSA JWT per
 * proxied request, and the in-VM sidecar verifies it against aomi-build's
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
  const { accessToken } = await buildService().mint({
    role: "service",
    subject: runId,
    audience: SIDECAR_AUDIENCE,
    ttlSeconds: SIDECAR_BEARER_TTL_SECONDS,
  });
  return accessToken;
}

/**
 * aomi-build's committed SPKI public key — the sidecar's verification anchor,
 * passed into the sandbox env at dispatch. Empty string when the topology is
 * unavailable; the sidecar then fails closed (rejects every request).
 */
export function sidecarVerifierPublicKeyPem(): string {
  try {
    return buildService().self.publicKey;
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
