import type { EdgeEnv } from "../env";
import type { FetchLike } from "../routing/upstream";

/** Everything the Build surface needs per request, resolved once. */
export type BuildContext = {
  env: EdgeEnv;
  /** The public Build origin this request arrived on (its own host). */
  buildOrigin: string;
  /** Where the Vercel Build app is reached from the edge (never the public host). */
  upstreamOrigin: string;
  /** Origins whose cookie writes Build trusts. */
  trustedOrigins: readonly string[];
  /** Cookies are Secure everywhere except local development. */
  secureCookies: boolean;
  /** Whether this is the production Build (which GitHub OAuth app to use). */
  production: boolean;
  /** The platforms Build deploys to; the first is the default. */
  deployPlatforms: readonly string[];
  fetchImpl: FetchLike;
  now: () => number;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PRODUCTION_BUILD_HOST = "build.aomi.dev";

function csv(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

/** Hosts the edge serves as the Build surface (routed on their /api and /v1). */
export function buildHosts(env: EdgeEnv): string[] {
  return csv(env.BUILD_HOSTS).map((host) => host.toLowerCase());
}

export function isBuildHost(env: EdgeEnv, host: string): boolean {
  return buildHosts(env).includes(host.toLowerCase());
}

export function buildContext(
  request: Request,
  env: EdgeEnv,
  fetchImpl: FetchLike,
  now: () => number = Date.now,
): BuildContext | null {
  const url = new URL(request.url);
  if (!isBuildHost(env, url.host)) return null;
  const upstreamOrigin = (env.BUILD_UPSTREAM_ORIGIN ?? "").trim().replace(/\/+$/, "");
  if (!upstreamOrigin) return null;
  const buildOrigin = url.origin;
  const platforms = csv(env.APP_DEPLOY_PLATFORMS);
  return {
    env,
    buildOrigin,
    upstreamOrigin,
    trustedOrigins: [...new Set([buildOrigin, ...csv(env.BUILD_TRUSTED_ORIGINS)])],
    secureCookies: !LOCAL_HOSTS.has(url.hostname),
    production: env.EDGE_TOPOLOGY === "production" || url.hostname === PRODUCTION_BUILD_HOST,
    deployPlatforms: platforms.length ? platforms : ["web"],
    fetchImpl,
    now,
  };
}
