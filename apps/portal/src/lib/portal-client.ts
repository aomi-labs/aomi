import { Aomi } from "@aomi-labs/client";
import { getBackendUrl } from "@aomi-labs/widget/host-composition";

/** Same-origin Edge: the Better Auth cookie is the credential. */
export function createPortalAomi(): Aomi {
  return new Aomi({
    baseUrl: getBackendUrl(),
    guest: false,
    fetch: (input, init) =>
      fetch(input, { ...init, credentials: "same-origin", cache: "no-store" }),
  });
}
