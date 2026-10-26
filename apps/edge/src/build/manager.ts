/**
 * The two Manager calls the Build sign-in flow makes, as `aomi-edge` with a
 * service bearer. PR 3b moves the rest of the Build control plane here through
 * the `@aomi-labs/internal` manager client; these stay small on purpose.
 */
import { edgeService } from "../identity";
import { rankOrigins, resolvePool, routingKeyFor } from "../routing/pool";
import { mintBearer } from "../portal/errors";
import { UpstreamUnreachableError } from "../portal/forward";
import type { BuildContext } from "./context";

export const BUILD_SERVICE_SUBJECT = "aomi-edge";
const SERVICE_BEARER_TTL_SECONDS = 5 * 60;

/** The Manager answered with an error status. */
export class ManagerError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${operation} failed with ${status}`);
    this.name = "ManagerError";
  }
}

export interface GitHubIdentity {
  githubUserId: string;
  githubLogin: string;
  installationId: string | null;
  visibilityGrant: string | null;
}

function managerOrigin(request: Request, ctx: BuildContext): string {
  const manager = (ctx.env.MANAGER_ORIGIN ?? "").trim();
  if (manager) return manager;
  const [origin] = rankOrigins(routingKeyFor(request, new URL(request.url)), resolvePool(ctx.env));
  if (!origin) throw new UpstreamUnreachableError(new Error("no backend origins"));
  return origin;
}

async function serviceBearer(request: Request, ctx: BuildContext): Promise<string> {
  const { accessToken } = await mintBearer(() =>
    edgeService(ctx.env, new URL(request.url).host).mint({
      role: "service",
      subject: BUILD_SERVICE_SUBJECT,
      audience: "aomi-backend",
      ttlSeconds: SERVICE_BEARER_TTL_SECONDS,
    }),
  );
  return accessToken;
}

async function call<T>(
  request: Request,
  ctx: BuildContext,
  operation: string,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const url = new URL(path, managerOrigin(request, ctx));
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${await serviceBearer(request, ctx)}`,
  });
  if (init.body !== undefined) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await ctx.fetchImpl(
      new Request(url, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
      { cache: "no-store" },
    );
  } catch (error) {
    throw new UpstreamUnreachableError(error);
  }
  if (!response.ok) throw new ManagerError(operation, response.status, await response.text());
  return (await response.json()) as T;
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** OAuth code → the verified GitHub identity behind it. */
export async function exchangeGitHubCode(
  request: Request,
  ctx: BuildContext,
  input: { code: string; app: number; redirectUri: string },
): Promise<GitHubIdentity> {
  const params = new URLSearchParams({
    code: input.code,
    app: String(input.app),
    redirect_uri: input.redirectUri,
  });
  const raw = await call<{
    github_user_id?: unknown;
    github_login?: unknown;
    installation_id?: unknown;
    visibility_grant?: unknown;
  }>(request, ctx, "exchange_github_code", `/api/integrations/github-app/oauth/exchange?${params}`, {
    method: "GET",
  });
  return {
    githubUserId: str(raw.github_user_id),
    githubLogin: str(raw.github_login),
    installationId:
      raw.installation_id === null || raw.installation_id === undefined ? null : String(raw.installation_id),
    visibilityGrant: typeof raw.visibility_grant === "string" ? raw.visibility_grant : null,
  };
}

/** Bind an org project to the GitHub user who just re-authorized. */
export async function claimGitHubProject(
  request: Request,
  ctx: BuildContext,
  input: { code: string; projectId: number; redirectUri: string },
): Promise<{ githubUserId: string }> {
  const raw = await call<{ github_user_id?: unknown }>(
    request,
    ctx,
    "claim_github_project",
    "/api/integrations/github-app/oauth/claim",
    {
      method: "POST",
      body: { code: input.code, project_id: input.projectId, redirect_uri: input.redirectUri },
    },
  );
  return { githubUserId: str(raw.github_user_id) };
}
