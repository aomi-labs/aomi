import "@tanstack/react-start/server-only";

import { portalService } from "@aomi-labs/account/server";
import { buildFailures } from "@/server/bff/failures";

/**
 * Sidecar auth rides the official service-bearer path (the same
 * PORTAL_SERVICE_PRIVATE_KEY + committed-topology signing that backend
 * bearers use — packages/account): the BFF mints a short-lived EdDSA JWT per
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
  const { accessToken } = await portalService().mint({
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
    return portalService().self.publicKey;
  } catch (error) {
    buildFailures.handle({
      source: "local",
      error,
      context: {
        routeFamily: "/api/bff/build",
        operation: "build.sidecar_verifier_config",
      },
    });
    return "";
  }
}
