import { decodeJwt } from "jose";
import { ROUTES, resourcesFor } from "@aomi-labs/account/policy";
import { isOAuthDiscovery } from "./auth/well-known";
import { authServer } from "./auth/server";
import type { EdgeEnv } from "./env";
import type { FetchLike, WaitLike } from "./kernel/proxy";
import type { PortalContext } from "./portal/context";

// authServer caches per env object, so the API issuer's env must be stable.
const issuerEnvs = new WeakMap<EdgeEnv, EdgeEnv>();

/** The account surface on the API host, with its own issuer. Chat hosts keep portalContext. */
export function headlessContext(
  request: Request,
  env: EdgeEnv,
  fetchImpl: FetchLike,
  wait: WaitLike,
): PortalContext | null {
  const url = new URL(request.url);
  if (!env.HEADLESS_API_ORIGIN || url.origin !== env.HEADLESS_API_ORIGIN) return null;
  const path = url.pathname;
  const rows = ROUTES.filter((row) => row.path.test(path));
  // Raw backend credentials keep the backend verifier, which still checks them.
  if (rows.length && rows.every((row) => row.to === "backend")) {
    const authorization = request.headers.get("authorization");
    if (!authorization && request.headers.has("aomi-app-key")) return null;
    const bearer = /^Bearer ([^ ]+)$/i.exec(authorization ?? "")?.[1];
    try {
      if (bearer && ["aomi-edge", "aomi-build"].includes(decodeJwt(bearer).iss ?? "")) return null;
    } catch {
      // An invalid explicit credential stays on the gateway and fails closed.
    }
  }
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
  let authEnv = issuerEnvs.get(env);
  if (!authEnv) {
    authEnv = { NODE_ENV: process.env.NODE_ENV, ...env, BETTER_AUTH_URL: url.origin } as EdgeEnv;
    issuerEnvs.set(env, authEnv);
  }
  return {
    env: authEnv,
    portalOrigin: url.origin,
    // Without a page upstream only the sign-in pages fail; tokens, discovery and MCP stay up.
    upstreamOrigin: env.HEADLESS_AUTH_UPSTREAM_ORIGIN ?? "",
    trustedOrigins: [url.origin],
    auth: () => authServer(authEnv),
    resources: resourcesFor(url.origin),
    fetchImpl,
    wait,
    now: Date.now,
  };
}
