import { AomiClient } from "@aomi-labs/client";
import { getBackendUrl } from "@aomi-labs/widget/host-composition";

/** Same-origin BFF: the Better Auth cookie is the credential. */
export function createPortalClient(): AomiClient {
  return new AomiClient({
    baseUrl: getBackendUrl(),
    guest: false,
    fetch: (input, init) =>
      fetch(input, { ...init, credentials: "same-origin", cache: "no-store" }),
  });
}
