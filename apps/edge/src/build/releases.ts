/**
 * The release API at the edge: package releases and agent configs, published,
 * listed and promoted by a builder API key, a CLI bearer or the GitHub session
 * cookie, plus the builder's read models (its publisher's agents and packages,
 * one agent, one package) and a package's builder secret values. `/api/build/<path>` is the manager's `/api/<path>`, proxied with the
 * raw body (a tar or JSON, at most 10 MB) and a builder bearer in place of the
 * caller's credential. A key needs the route's capability; a session holds
 * them all. The manager parses, checks and stores everything.
 */
import type { GitHubCliScope } from "@aomi-labs/account/build-session";
import { RELEASE_MAX_BYTES } from "@aomi-labs/internal";

import { EdgeError, minted } from "../kernel/errors";
import { proxy, target } from "../kernel/proxy";
import { BACKEND_API_HEADERS } from "../portal/headers";
import { RELEASE_CAPABILITIES } from "./api-keys";
import { authorize } from "./auth";
import type { BuildContext } from "./context";
import type { BuildRoute, Handler, Method } from "./endpoint";
import { apiOrigin, builderBearer } from "./manager-client";

type Capability = (typeof RELEASE_CAPABILITIES)[number];

const HEADERS = {
  request: new Set([...BACKEND_API_HEADERS.request, "x-aomi-source-repo", "x-aomi-source-commit"]),
  response: BACKEND_API_HEADERS.response,
};

/** The body, refused with 413 past the release limit whatever its declared length. */
async function bounded(request: Request): Promise<Blob> {
  if (Number(request.headers.get("content-length")) > RELEASE_MAX_BYTES) throw new EdgeError(413, "too_large");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  for (let read = await reader?.read(); read && !read.done; read = await reader!.read()) {
    size += read.value.byteLength;
    if (size > RELEASE_MAX_BYTES) {
      await reader!.cancel();
      throw new EdgeError(413, "too_large");
    }
    chunks.push(read.value);
  }
  // Stream chunks own their buffers.
  return new Blob(chunks as Uint8Array<ArrayBuffer>[]);
}

/** A key is held to `capability`; reads need none. A CLI bearer needs `cliScope`. */
function forward(capability: Capability | null, cliScope: GitHubCliScope): Handler {
  return async (request: Request, ctx: BuildContext) => {
    const read = request.method === "GET";
    const caller = await authorize(request, ctx, { write: !read, cliScope });
    if (caller.key && capability && !caller.key.capabilities.includes(capability))
      throw new EdgeError(403, "insufficient_scope");
    const body = read ? undefined : await bounded(request);
    const { accessToken } = await minted(() =>
      caller.key
        ? builderBearer(ctx, caller.key.builderId, caller.key.capabilities, "api_key")
        : builderBearer(ctx, caller.session.githubUserId, RELEASE_CAPABILITIES, caller.cli ? "cli_session" : "session"),
    );
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/build\//, "/api/");
    const outgoing = new Request(request.url, { method: request.method, headers: request.headers, body });
    return proxy(outgoing, target(apiOrigin(request, ctx, path), path, url.search), {
      fetchImpl: ctx.fetchImpl,
      headers: HEADERS,
      bearer: accessToken,
    });
  };
}

function route(
  operation: string,
  method: Method,
  path: RegExp,
  capability: Capability | null,
  cliScope: GitHubCliScope,
): BuildRoute {
  return { operation, method, path, handle: forward(capability, cliScope), keys: true };
}

const PACKAGE_RELEASES = /^\/api\/build\/packages\/[^/]+\/releases$/;
const AGENT_CONFIGS = /^\/api\/build\/agents\/[^/]+\/configs$/;
const PACKAGE_SECRET = /^\/api\/build\/packages\/[^/]+\/secrets\/[^/]+$/;

export const RELEASE_ROUTES: readonly BuildRoute[] = [
  route("publisher.me", "GET", /^\/api\/build\/publishers\/me$/, null, "deployment:read"),
  route("agent.detail", "GET", /^\/api\/build\/agents\/[^/]+$/, null, "deployment:read"),
  route("package.detail", "GET", /^\/api\/build\/packages\/[^/]+$/, null, "deployment:read"),
  route("package.secret.set", "PUT", PACKAGE_SECRET, "package:secrets", "deploy"),
  route("package.secret.delete", "DELETE", PACKAGE_SECRET, "package:secrets", "deploy"),
  route("package.publish", "POST", PACKAGE_RELEASES, "package:publish", "deploy"),
  route("package.releases", "GET", PACKAGE_RELEASES, null, "deployment:read"),
  route("package.promote", "POST", /^\/api\/build\/packages\/[^/]+\/promote$/, "package:promote", "activate"),
  route("agent.publish", "POST", AGENT_CONFIGS, "agent:publish", "deploy"),
  route("agent.configs", "GET", AGENT_CONFIGS, null, "deployment:read"),
  route("agent.promote", "POST", /^\/api\/build\/agents\/[^/]+\/promote$/, "agent:promote", "activate"),
];
