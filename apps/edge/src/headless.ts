import { decodeJwt } from "jose";
import { ROUTES, resourcesFor } from "@aomi-labs/account/policy";
import { isOAuthDiscovery } from "./auth/well-known";
import { authEnvironment, authServer } from "./auth/server";
import type { EdgeEnv } from "./env";
import type { FetchLike, WaitLike } from "./kernel/proxy";
import type { PortalContext } from "./portal/context";

/** One independently configured issuer on the API host. Legacy portal issuers stay untouched. */
export function headlessContext(
  request: Request,
  env: EdgeEnv,
  fetchImpl: FetchLike,
  wait: WaitLike,
): PortalContext | null {
  const url = new URL(request.url);
  if (!env.HEADLESS_API_ORIGIN || url.origin !== env.HEADLESS_API_ORIGIN)
    return null;
  const path = url.pathname;
  const rows = ROUTES.filter((row) => row.path.test(path));
  // Existing raw backend clients keep that verifier. Decoding only selects the
  // already-public backend router; its signature/audience checks still authorize.
  if (rows.length && rows.every((row) => row.to === "backend")) {
    const authorization = request.headers.get("authorization");
    if (!authorization && request.headers.has("aomi-app-key")) return null;
    const match = /^Bearer ([^ ]+)$/i.exec(authorization ?? "");
    if (match) {
      try {
        if (["aomi-edge", "aomi-build"].includes(decodeJwt(match[1]).iss ?? "")) return null;
      } catch {
        // An invalid explicit credential stays on the gateway and fails closed.
      }
    }
  }
  // Venue discovery, Task payments, webhooks and Manager keep their existing API router.
  const owns =
    path === "/api/auth" ||
    path.startsWith("/api/auth/") ||
    isOAuthDiscovery(path) ||
    rows.length > 0 ||
    path.startsWith("/oauth/") ||
    path.startsWith("/assets/") ||
    path === "/.well-known/api-catalog" ||
    path.startsWith("/api/public/catalog/");
  if (!owns) return null;
  const authEnv = authEnvironment(env, url.origin);
  return {
    env: authEnv,
    portalOrigin: url.origin,
    // An absent UI upstream must not disable auth, tokens or MCP. Only page requests fail closed.
    upstreamOrigin: env.HEADLESS_AUTH_UPSTREAM_ORIGIN ?? "",
    trustedOrigins: [url.origin],
    auth: () => authServer(authEnv),
    resources: resourcesFor(url.origin),
    fetchImpl,
    wait,
    now: Date.now,
  };
}
