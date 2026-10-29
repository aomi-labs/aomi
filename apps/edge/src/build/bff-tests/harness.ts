/**
 * Test harness for the Build control plane: the Vercel Build BFF's own route
 * tests, run against the edge. Each export takes the Request the BFF test
 * built and serves it through `handleRequest` on a Build host at that route's
 * path and method, with the test's mocked GitHub session as a signed cookie
 * (or a CLI bearer for "Bearer cli-session") and the test's global `fetch` as
 * the manager.
 */
import { vi } from "vitest";

import type { EdgeEnv } from "../../env";
import { handleRequest } from "../../handler";
import { GitHubSessionSigner, type GitHubSession } from "../session";

const SECRET = "build-session-secret-for-tests";
export const BUILD_ORIGIN = "http://localhost:3000";
export const MANAGER_ORIGIN = "http://127.0.0.1:8080";

const DEV_PRIVATE_KEY = [
  "-----BEGIN PRIVATE KEY-----",
  "MC4CAQAwBQYDK2VwBCIEIAJez/5pUy9hG5xNVsHP+4GQ6ZgxHDdzFoZ2GwvkHgx/",
  "-----END PRIVATE KEY-----",
].join("\n");

export const env: EdgeEnv = {
  BUILD_HOSTS: "localhost:3000",
  BUILD_UPSTREAM_ORIGIN: "http://build-vercel.invalid",
  BUILD_SESSION_SECRET: SECRET,
  BUILD_GITHUB_TOKEN: "gh-token",
  BACKEND_ORIGINS: MANAGER_ORIGIN,
  MANAGER_ORIGIN,
  APP_DEPLOY_PLATFORMS: "community",
  EDGE_TOPOLOGY: "default",
  EDGE_SERVICE_PRIVATE_KEY: DEV_PRIVATE_KEY,
};

/** The signed-in GitHub user, as the BFF tests mock it (null = signed out). */
export const getGitHubSession = vi.fn<() => Promise<Partial<GitHubSession> | null>>();

const signer = new GitHubSessionSigner(SECRET);

async function asEdgeRequest(original: Request, path: string, method: string): Promise<Request> {
  const incoming = new URL(original.url);
  const headers = new Headers(original.headers);
  const session = await getGitHubSession();
  const full: GitHubSession | null = session?.githubUserId
    ? {
        githubUserId: session.githubUserId,
        githubLogin: session.githubLogin ?? "",
        installationId: session.installationId ?? null,
      }
    : null;
  if (headers.get("authorization") === "Bearer cli-session") {
    if (full) headers.set("authorization", `Bearer ${await signer.issueCliSession(full)}`);
    else headers.delete("authorization");
  } else if (full && !headers.has("cookie")) {
    headers.set("cookie", `aomi_github=${await signer.issueSession(full)}`);
  }
  const body = method === "GET" || method === "HEAD" ? undefined : await original.text();
  return new Request(`${BUILD_ORIGIN}${path}${incoming.search}`, { method, headers, body });
}

/** The manager is the test's global fetch, called the way the BFF called it. */
async function manager(request: Request): Promise<Response> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => (headers[name] = value));
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
  return globalThis.fetch(request.url, { method: request.method, headers, ...(body !== undefined ? { body } : {}) });
}

export function route(path: string | ((url: URL) => string), method?: string) {
  return async (request: Request): Promise<Response> => {
    const target = typeof path === "string" ? path : path(new URL(request.url));
    return handleRequest(await asEdgeRequest(request, target, method ?? request.method), env, manager);
  };
}
