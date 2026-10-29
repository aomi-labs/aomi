import type { EdgeEnv } from "../env";
import { config, type Config } from "../kernel/config";
import type { FetchLike } from "../kernel/proxy";

/** Everything the Build surface needs per request, resolved once. */
export type BuildContext = {
  env: EdgeEnv;
  config: Config["build"];
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
  fetchImpl: FetchLike;
  now: () => number;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isBuildHost(env: EdgeEnv, host: string): boolean {
  return config(env).build.hosts.has(host.toLowerCase());
}

export function buildContext(
  request: Request,
  env: EdgeEnv,
  fetchImpl: FetchLike,
  now: () => number = Date.now,
): BuildContext | null {
  const url = new URL(request.url);
  const { build } = config(env);
  if (!build.hosts.has(url.host.toLowerCase()) || !build.upstream) return null;
  return {
    env,
    config: build,
    buildOrigin: url.origin,
    upstreamOrigin: build.upstream,
    trustedOrigins: [...new Set([url.origin, ...build.trustedOrigins])],
    secureCookies: !LOCAL_HOSTS.has(url.hostname),
    production: env.EDGE_TOPOLOGY === "production" || url.hostname === "build.aomi.dev",
    fetchImpl,
    now,
  };
}
