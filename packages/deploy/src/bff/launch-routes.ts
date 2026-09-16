// =============================================================================
// createLaunchRoutes — the one-shot deploy BFF as drop-in route handlers.
//
// Every handler is a plain `(Request) => Promise<Response>`, so a Next.js host
// mounts them directly as App Router route exports:
//
//   // app/api/bff/launch/deploy/route.ts
//   import { launchRoutes } from "@/server/launch";
//   export const POST = launchRoutes.deploy;
//
// The host injects the privileged pieces; nothing here reads a framework:
//   - `client`   — a BackendClient carrying the activation/service bearer
//   - `session`  — the signed-in GitHub user for a request (see
//                  `createGitHubSessionCodec` for the batteries-included one)
//   - `guards`   — rate-limit/CSRF (defaults provided)
//
// No GitHub credential is configured here: CI status and rerun go through the
// Aomi backend, whose GitHub App installation token makes every GitHub call.
//
// Also owns launch config resolution (env → LaunchConfig) and deployment
// payload → client summary mappers.
// =============================================================================

import type { BackendClient } from "../backend";
import type { PlatformApp } from "../types";
import { assertServerOnly } from "../backend";
import {
  DEFAULT_TEMPLATE_REPO,
  deploymentTargets,
  type LaunchAppStatusesResult,
} from "../launch/contracts";
import { launchErrorResponse } from "./errors";
import {
  createDefaultGuards,
  isValidDeploymentId,
  isValidInstallationId,
  isValidProjectId,
  isValidReleaseTags,
  isValidRepo,
  jsonResponse,
  randomHex,
  type LaunchGuards,
} from "./http";
import type { GitHubSession } from "./auth";
import { missingSecretsForActivation } from "./release-manifest";

export const DEFAULT_DEPLOY_PLATFORM = "community";
export { DEFAULT_TEMPLATE_REPO };

export type LaunchConfig = {
  /** Platform every launch route operates on (first of `platforms`). */
  platform: string;
  /** All deployable platforms, first is the default. */
  platforms: string[];
  /** Platforms whose apps show in the catalog (optional). */
  catalogPlatforms: string[];
  /** Template `owner/repo` the one-shot flow forks. */
  templateRepo: string;
  /** Create scaffolded repos as private. */
  createdRepoPrivate: boolean;
  /** Target tags applied on activation (e.g. ["staging"]). */
  targetTags: string[];
};

function envString(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function envJsonOrCommaList(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return dedupe(
        parsed
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean),
      );
    }
  } catch {
    // Fall through to comma-separated parsing for Vercel/plain .env ergonomics.
  }

  return dedupe(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function deployPlatformsFromEnv(): string[] {
  for (const name of [
    "APP_DEPLOY_PLATFORMS",
    "NEXT_PUBLIC_APP_DEPLOY_PLATFORMS",
    "APP_DEPLOY_PLATFORM",
    "NEXT_PUBLIC_APP_DEPLOY_PLATFORM",
  ]) {
    const platforms = envJsonOrCommaList(name);
    if (platforms.length > 0) return platforms;
  }

  return [DEFAULT_DEPLOY_PLATFORM];
}

function catalogPlatformsFromEnv(): string[] {
  for (const name of [
    "APP_CATALOG_PLATFORMS",
    "NEXT_PUBLIC_APP_CATALOG_PLATFORMS",
  ]) {
    const platforms = envJsonOrCommaList(name);
    if (platforms.length > 0) return platforms;
  }

  return [];
}

/** Resolve the launch config: explicit overrides win, then env, then defaults. */
export function resolveLaunchConfig(
  overrides?: Partial<LaunchConfig>,
): LaunchConfig {
  const platforms =
    overrides?.platforms ??
    (overrides?.platform ? [overrides.platform] : deployPlatformsFromEnv());

  return {
    platform: overrides?.platform ?? platforms[0],
    platforms,
    catalogPlatforms: overrides?.catalogPlatforms ?? catalogPlatformsFromEnv(),
    templateRepo:
      overrides?.templateRepo ??
      (process.env.APP_DEPLOY_TEMPLATE_REPO?.trim() ||
        envString(
          "NEXT_PUBLIC_APP_DEPLOY_TEMPLATE_REPO",
          DEFAULT_TEMPLATE_REPO,
        )),
    createdRepoPrivate:
      overrides?.createdRepoPrivate ??
      envBoolean("APP_DEPLOY_CREATED_REPO_PRIVATE", false),
    targetTags: overrides?.targetTags ?? envList("APP_DEPLOY_TARGET_TAGS"),
  };
}

/** Map BackendClient app flags to the browser-safe project runtime contract. */
export function launchAppStatusesResult(
  projectId: number,
  apps: readonly PlatformApp[],
): LaunchAppStatusesResult {
  const runtimeApps = apps.map((app) => ({
    id: app.id,
    name: app.name,
    is_active: app.isActive,
    loaded: app.loaded,
    app_release_tag: app.appReleaseTag,
  }));
  const live =
    runtimeApps.length > 0 &&
    runtimeApps.every((app) => app.is_active && app.loaded);
  return {
    ok: true,
    projectId,
    state: live ? "live" : "pending",
    apps: runtimeApps,
  };
}

export type LaunchRouteHandler = (req: Request) => Promise<Response>;

export type LaunchRoutes = {
  /** POST — dry-run deploy; resolves an existing Project by id or repo. */
  preflight: LaunchRouteHandler;
  /** POST — the apply step against a resolved project. */
  deploy: LaunchRouteHandler;
  /** POST — one-shot: scaffold a repo from the template for the signed-in user. */
  create: LaunchRouteHandler;
  /** POST — promote built release tags to live. */
  activate: LaunchRouteHandler;
  /** GET `?deploymentId=` — deployment status; CI resolved by the backend. */
  status: LaunchRouteHandler;
  /** GET `?projectId=` — one project's live/pending app runtime states. */
  apps: LaunchRouteHandler;
  /** POST — re-run the recorded CI run for a project's latest deployment. */
  redeploy: LaunchRouteHandler;
  /** GET — the signed-in user's projects + their apps. */
  projects: LaunchRouteHandler;
};

export type LaunchRoutesOptions = {
  /** Deployment client per request — holds the activation/service bearer. */
  client: () => BackendClient | Promise<BackendClient>;
  /** The signed-in GitHub session for a request, or null. */
  session: (
    req: Request,
  ) => GitHubSession | null | Promise<GitHubSession | null>;
  /** Platform/template config. Defaults from `APP_DEPLOY_*` env. */
  config?: Partial<LaunchConfig>;
  /** Read/write request guards. Defaults: per-IP rate limit + same-origin. */
  guards?: Partial<LaunchGuards>;
  /** Prefix for generated one-shot repo names. Default `my-playground`. */
  createdRepoPrefix?: string;
};

function sourceRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(clean) ? clean : null;
}

type OwnedProject = Awaited<
  ReturnType<BackendClient["listUserProjects"]>
>[number];

/**
 * Prove the signed-in user owns `projectId` and return the project row. The
 * lookup is account-wide — partner-bound projects included — so ownership
 * never depends on a platform parameter.
 */
async function ownedProject(
  client: BackendClient,
  githubUserId: string,
  projectId: number,
): Promise<OwnedProject | null> {
  const projects = await client.listUserProjects({ githubUserId });
  return projects.find((candidate) => candidate.id === projectId) ?? null;
}

/** The Project's persisted platform is authoritative after creation. */
function platformOf(project: OwnedProject): string {
  return project.platformName;
}

export function createLaunchRoutes(options: LaunchRoutesOptions): LaunchRoutes {
  assertServerOnly();

  const defaults = createDefaultGuards();
  const checkRead = options.guards?.read ?? defaults.read;
  const checkWrite = options.guards?.write ?? defaults.write;
  const getClient = options.client;
  const getSession = options.session;
  const createdRepoPrefix = options.createdRepoPrefix ?? "my-playground";
  const config = () => resolveLaunchConfig(options.config);

  async function defaultRepoName(): Promise<string> {
    const normalized = createdRepoPrefix
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `${normalized}-${await randomHex(4)}`;
  }

  function deployRoute(preflight: boolean): LaunchRouteHandler {
    return async function POST(req: Request): Promise<Response> {
      const blocked = checkWrite(req);
      if (blocked) return blocked;

      const body = (await req.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (body.projectId !== undefined && !isValidProjectId(body.projectId)) {
        return jsonResponse({ error: "invalid `projectId`" }, 400);
      }
      if (body.repo !== undefined && !isValidRepo(body.repo)) {
        return jsonResponse({ error: "invalid `repo`" }, 400);
      }
      const repo = isValidRepo(body.repo) ? body.repo : undefined;

      try {
        const session = await getSession(req);
        if (!session) {
          return jsonResponse({ error: "not signed in with GitHub" }, 401);
        }
        const client = await getClient();

        // Preflight may resolve an existing Project by repository. It never
        // creates one: `project create` owns that lifecycle. Apply reuses the
        // immutable Project id and commit returned by preflight.
        let projectId: number;
        let deploySourceRef = sourceRef(body.sourceRef);
        if (isValidProjectId(body.projectId)) {
          const project = await ownedProject(
            client,
            session.githubUserId,
            body.projectId,
          );
          if (!project) {
            return jsonResponse(
              { error: "project not found for this user" },
              404,
            );
          }
          projectId = project.id;
        } else if (preflight && repo) {
          const projects = await client.listUserProjects({
            githubUserId: session.githubUserId,
          });
          const project = projects.find(
            (candidate) =>
              candidate.repositoryLink.trim().toLowerCase() ===
              repo.toLowerCase(),
          );
          if (!project) {
            return jsonResponse(
              {
                error:
                  "repository is not connected as a Project; run `aomi-build project create` first",
              },
              404,
            );
          }
          projectId = project.id;
        } else {
          return jsonResponse(
            {
              error: preflight
                ? "missing `projectId` or `repo`"
                : "missing `projectId`",
            },
            400,
          );
        }

        if (!preflight && !deploySourceRef) {
          return jsonResponse(
            {
              error: "missing source commit from preflight",
            },
            400,
          );
        }

        const actor = typeof body.actor === "string" ? body.actor : undefined;
        const { deployment } = preflight
          ? await client.preflight({
              projectId,
              sourceRef: deploySourceRef ?? undefined,
              actor,
            })
          : await client.deploy({
              projectId,
              sourceRef: deploySourceRef!,
              actor,
            });
        const targets = deploymentTargets(deployment);
        return jsonResponse(
          {
            ok: true,
            repo: deployment.source.repositoryLink ?? repo,
            installationId: deployment.source.installationId
              ? String(deployment.source.installationId)
              : undefined,
            projectId,
            sourceRef: deployment.source.commitHash,
            deployment,
            releaseTags: targets.map((target) => target.releaseTag),
            apps: targets.map((target) => target.name),
          },
          preflight ? 200 : 202,
        );
      } catch (err) {
        return launchErrorResponse(err);
      }
    };
  }

  const create: LaunchRouteHandler = async (req) => {
    const blocked = checkWrite(req);
    if (blocked) return blocked;

    // The created project is owned by the signed-in GitHub user — taken from
    // the server-side session, never trusted from the client body.
    const session = await getSession(req);
    if (!session) {
      return jsonResponse({ error: "not signed in with GitHub" }, 401);
    }

    try {
      const body = (await req.json().catch(() => ({}))) as {
        installationId?: unknown;
        repoName?: string;
      };
      if (!isValidInstallationId(body.installationId)) {
        return jsonResponse(
          { error: "missing or invalid `installationId`" },
          400,
        );
      }

      const cfg = config();
      const client = await getClient();
      const project = await client.scaffold({
        platform: cfg.platform,
        installationId: Number(body.installationId),
        templateRepo: cfg.templateRepo,
        repoName: body.repoName?.trim() || (await defaultRepoName()),
        githubUserId: session.githubUserId,
        private: cfg.createdRepoPrivate,
      });
      if (!project.repositoryLink || !project.installationId) {
        return jsonResponse(
          { error: "backend did not return a created project" },
          502,
        );
      }
      return jsonResponse(
        {
          ok: true,
          repo: project.repositoryLink,
          installationId: String(project.installationId),
          projectId: project.id,
          project,
        },
        200,
      );
    } catch (err) {
      return launchErrorResponse(err);
    }
  };

  const status: LaunchRouteHandler = async (req) => {
    const blocked = checkRead(req);
    if (blocked) return blocked;

    const deploymentId = new URL(req.url).searchParams.get("deploymentId");
    if (!isValidDeploymentId(deploymentId)) {
      return jsonResponse({ error: "missing or invalid `deploymentId`" }, 400);
    }

    try {
      const cfg = config();
      const client = await getClient();
      // The backend resolves CI live per poll (by the deployment's recorded
      // commit, on its App installation token) and deep-links the run URL.
      const result = await client.status({
        platform: cfg.platform,
        deploymentId,
      });
      return jsonResponse(
        {
          ...result,
          releaseTags: deploymentTargets(result.deployment).map(
            (target) => target.releaseTag,
          ),
        },
        200,
      );
    } catch (err) {
      return launchErrorResponse(err);
    }
  };

  const activate: LaunchRouteHandler = async (req) => {
    const blocked = checkWrite(req);
    if (blocked) return blocked;

    const session = await getSession(req);
    if (!session) {
      return jsonResponse({ error: "not signed in with GitHub" }, 401);
    }

    try {
      const body = (await req.json().catch(() => ({}))) as {
        releaseTags?: unknown;
        projectId?: unknown;
        apps?: unknown;
        actor?: string;
      };
      if (!isValidReleaseTags(body.releaseTags)) {
        return jsonResponse({ error: "missing or invalid `releaseTags`" }, 400);
      }
      if (!isValidProjectId(body.projectId)) {
        return jsonResponse({ error: "missing or invalid `projectId`" }, 400);
      }
      if (
        !Array.isArray(body.apps) ||
        !body.apps.every((app) => typeof app === "string")
      ) {
        return jsonResponse({ error: "missing or invalid `apps`" }, 400);
      }

      const releaseTags = body.releaseTags;
      const apps = body.apps.map((app) => app.trim()).filter(Boolean);
      if (apps.length === 0 || apps.length !== releaseTags.length) {
        return jsonResponse(
          { error: "`apps` must match `releaseTags` length" },
          400,
        );
      }

      const client = await getClient();
      const project = await ownedProject(
        client,
        session.githubUserId,
        body.projectId,
      );
      if (!project) {
        return jsonResponse({ error: "project not found for this user" }, 404);
      }
      const pairs = apps.map((app, index) => ({
        app,
        releaseTag: releaseTags[index],
      }));
      const missingByApp = await missingSecretsForActivation({
        client,
        githubUserId: session.githubUserId,
        project,
        pairs,
      });
      if (Object.keys(missingByApp).length > 0) {
        return jsonResponse(
          { error: "missing required secrets", missing: missingByApp },
          409,
        );
      }
      const result = await client.activateUserProjectReleases({
        githubUserId: session.githubUserId,
        projectId: project.id,
        releaseTags,
        apps,
        actor: typeof body.actor === "string" ? body.actor : undefined,
      });
      return jsonResponse(result, 200);
    } catch (err) {
      return launchErrorResponse(err);
    }
  };

  const apps: LaunchRouteHandler = async (req) => {
    const blocked = checkRead(req);
    if (blocked) return blocked;

    const session = await getSession(req);
    if (!session) {
      return jsonResponse({ error: "not signed in with GitHub" }, 401);
    }

    const projectId = Number(new URL(req.url).searchParams.get("projectId"));
    if (!isValidProjectId(projectId)) {
      return jsonResponse({ error: "missing or invalid `projectId`" }, 400);
    }

    try {
      const client = await getClient();
      const owner = await ownedProject(client, session.githubUserId, projectId);
      if (!owner) {
        return jsonResponse({ error: "project not found for this user" }, 404);
      }
      const result = await client.listUserProjectApps({
        githubUserId: session.githubUserId,
        projectId: owner.id,
      });
      return jsonResponse(launchAppStatusesResult(owner.id, result.apps), 200);
    } catch (err) {
      return launchErrorResponse(err);
    }
  };

  const redeploy: LaunchRouteHandler = async (req) => {
    const blocked = checkWrite(req);
    if (blocked) return blocked;

    const session = await getSession(req);
    if (!session) {
      return jsonResponse({ error: "not signed in with GitHub" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!isValidProjectId(body.projectId)) {
      return jsonResponse({ error: "missing or invalid `projectId`" }, 400);
    }

    try {
      const client = await getClient();
      const project = await ownedProject(
        client,
        session.githubUserId,
        body.projectId,
      );
      if (!project) {
        return jsonResponse({ error: "project not found for this user" }, 404);
      }
      const latest = await client.getUserProjectLatestDeployment({
        githubUserId: session.githubUserId,
        projectId: body.projectId,
      });
      const deploymentId = latest?.deploymentId ?? null;
      if (!deploymentId) {
        return jsonResponse(
          {
            error:
              "No backend-owned deployment is available for this project yet; refusing to reuse Deploy because GitHub can skip tree-identical pushes.",
          },
          409,
        );
      }

      // The backend re-runs the Actions run behind the deployment's recorded
      // commit on its App installation token; no GitHub token in this layer.
      const rerun = await client.rerunDeployment({
        platform: platformOf(project),
        deploymentId,
        githubUserId: session.githubUserId,
      });
      return jsonResponse(
        {
          ok: rerun.ok,
          projectId: body.projectId,
          platformRepo: latest?.platformRepo ?? null,
          ciRunId: rerun.runId === null ? null : String(rerun.runId),
          ciUrl: rerun.ciUrl ?? latest?.ciUrl ?? null,
        },
        200,
      );
    } catch (err) {
      return launchErrorResponse(err);
    }
  };

  // The signed-in user's projects across every bound platform. Scoped to the
  // github_user_id in the session — a client can never request someone else's
  // projects. `?platform=` is an explicit narrowing filter, never a default.
  const projects: LaunchRouteHandler = async (req) => {
    const blocked = checkRead(req);
    if (blocked) return blocked;

    const session = await getSession(req);
    if (!session) {
      return jsonResponse({ error: "not signed in with GitHub" }, 401);
    }

    try {
      const client = await getClient();
      const platform =
        new URL(req.url).searchParams.get("platform")?.trim() || undefined;
      const result = await client.listUserProjects({
        githubUserId: session.githubUserId,
        platform,
      });
      return jsonResponse(
        { projects: result, githubLogin: session.githubLogin },
        200,
      );
    } catch (err) {
      return launchErrorResponse(err);
    }
  };

  return {
    preflight: deployRoute(true),
    deploy: deployRoute(false),
    create,
    activate,
    status,
    apps,
    redeploy,
    projects,
  };
}
