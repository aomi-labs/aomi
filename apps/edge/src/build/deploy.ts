/**
 * Build's launch and deployments families, ported from the Build BFF
 * (`server/bff/deploy/{routes,attempts,github-app,project-upgrade}.ts`). Same
 * validation, ownership checks, caches and response shapes; the manager is
 * called through `@aomi-labs/internal` with an `aomi-edge` service bearer.
 */
import { BackendError, builderSecretSlots, missingRequiredSecrets } from "@aomi-labs/deploy";
import { deploymentTargets } from "@aomi-labs/deploy/launch";
import {
  launchAppStatusesResult,
  missingSecretsForActivation,
  ownedProject,
  RequiredSecretsCheckError,
  TimedPromiseCache,
  type ManagerClient,
} from "@aomi-labs/internal";

import { authorize } from "./auth";
import { deployConfig, randomHex, resolveDeployPlatform } from "./config";
import type { BuildContext } from "./context";
import { failureResponse } from "./failures";
import { managerClient, sdkBackendUrl } from "./manager-client";
import {
  isValidDeploymentId,
  isValidInstallationId,
  isValidReleaseTags,
  isValidRepo,
} from "./validate";

const CREATED_REPO_PREFIX = "my-playground";

// Server-side timing for the manager reads on the project page's critical
// path. Read these off a staging load to tell a heavy manager query from a
// fat payload or pool contention — they want different fixes.
async function timedManagerRead<T>(
  label: string,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await run();
  } finally {
    console.info(
      `deploy bff: ${label} took ${Math.round(performance.now() - startedAt)}ms`,
    );
  }
}

type BackendClientInstance = ManagerClient;

function deployErrorContext(req: Request, operation: string) {
  return {
    routeFamily: new URL(req.url).pathname,
    operation,
    method: req.method,
  };
}

type OwnedProject = Awaited<
  ReturnType<BackendClientInstance["listUserProjects"]>
>[number];

/** The signed-in user's projects. Ownership checks always read the
 *  account-wide list (platform undefined) so partner-bound projects are never
 *  invisible; an explicit platform is only a Projects-page narrowing filter. */
function cachedUserProjects(
  client: BackendClientInstance,
  githubUserId: string,
  platform?: string,
): Promise<OwnedProject[]> {
  return readCache.projects.get([githubUserId, platform ?? null], () =>
    client.listUserProjects({ githubUserId, platform }),
  );
}

/** The platform every downstream platform-addressed call must use once a
 *  project is known: the project's required bound platform. */
function projectPlatform(project: OwnedProject): string {
  const platform = project.platformName.trim();
  if (!platform) throw new Error("project is missing its bound platform");
  return platform;
}

// Read cache for the hot project-page GETs. Same 15s TTL as operate's, and it
// coalesces concurrent mounts onto one manager call — but unlike operate's
// read-only routes, deploy mutations CHANGE what these reads return (preflight
// re-syncs the source and can register apps; activate/promote/deactivate move
// the live release), so every source-mutating route clears it. Without that,
// the redeploy flow's `reload()` after preflight would read a stale list and
// the required-secrets gate could fail for an app the UI has no row for.
const READ_CACHE_TTL_MS = 15_000;

const readCache = {
  projects: new TimedPromiseCache<OwnedProject[]>(READ_CACHE_TTL_MS),
  projectDetails: new TimedPromiseCache<OwnedProject>(READ_CACHE_TTL_MS),
  serverTags: new TimedPromiseCache<
    Awaited<ReturnType<BackendClientInstance["serverTags"]>>
  >(READ_CACHE_TTL_MS),
};

export function clearDeployReadCache() {
  Object.values(readCache).forEach((cache) => cache.clear());
}

/** The signed-in user's project with `projectId`, or null if not theirs.
 *  Account-wide: the backend scopes listUserProjects to the session's GitHub
 *  user id, so an id absent from the result is not owned by the caller. */
async function findOwnedProject(
  client: BackendClientInstance,
  githubUserId: string,
  projectId: number,
): Promise<OwnedProject | null> {
  return ownedProject(
    (input) => cachedUserProjects(client, input.githubUserId),
    githubUserId,
    projectId,
  );
}

function defaultRepoName() {
  const normalized = CREATED_REPO_PREFIX.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${normalized}-${randomHex(4)}`;
}

function isValidProjectId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isValidApplicationId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function sourceRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(clean) ? clean : null;
}

function requestedPlatformFromUrl(
  req: Request,
  configured: ReturnType<typeof deployConfig>,
): string | null {
  return resolveDeployPlatform(
    new URL(req.url).searchParams.get("platform") ?? undefined,
    configured,
  );
}

function invalidPlatformResponse(): Response {
  return Response.json(
    { error: "unknown or unavailable `platform`" },
    { status: 400 },
  );
}

export function deployRoute(preflight: boolean) {
  return async function POST(req: Request, ctx: BuildContext): Promise<Response> {
    const auth = await authorize(req, ctx, { write: true, cliScope: "deploy" });
    if ("response" in auth) return auth.response;
    const { session } = auth;

    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (body.projectId !== undefined && !isValidProjectId(body.projectId)) {
      return Response.json(
        { error: "invalid `projectId`" },
        { status: 400 },
      );
    }
    if (body.repo !== undefined && !isValidRepo(body.repo)) {
      return Response.json({ error: "invalid `repo`" }, { status: 400 });
    }
    const repo = isValidRepo(body.repo) ? body.repo : undefined;

    try {
      const client = await managerClient(req, ctx);

      // Preflight resolves an existing Project by repository; creation is an
      // explicit lifecycle. Apply reuses preflight's Project and commit.
      let projectId: number;
      let deploySourceRef = sourceRef(body.sourceRef);
      if (isValidProjectId(body.projectId)) {
        // An explicit project id must belong to the signed-in user.
        const project = await findOwnedProject(
          client,
          session.githubUserId,
          body.projectId,
        );
        if (!project) {
          return Response.json(
            { error: "project not found for this user" },
            { status: 404 },
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
          return Response.json(
            {
              error:
                "repository is not connected as a Project; run `aomi-build project create` first",
            },
            { status: 404 },
          );
        }
        projectId = project.id;
      } else {
        return Response.json(
          {
            error: preflight
              ? "missing `projectId` or `repo`"
              : "missing `projectId`",
          },
          { status: 400 },
        );
      }

      if (!preflight && !deploySourceRef) {
        return Response.json(
          { error: "missing source commit from preflight" },
          { status: 400 },
        );
      }

      const actor = session.githubLogin;
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
      // Preflight re-syncs the source (and can register new apps); deploy
      // records a new deployment. The next projects read must see it.
      clearDeployReadCache();
      const projectUrl = new URL(`/projects/${projectId}`, req.url);
      projectUrl.searchParams.set("tab", "deployments");
      const targets = deploymentTargets(deployment);
      return Response.json(
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
          projectUrl: projectUrl.toString(),
        },
        { status: preflight ? 200 : 202 },
      );
    } catch (err) {
      return failureResponse(err, deployErrorContext(
          req,
          preflight ? "launch.preflight" : "launch.deploy",
        ));
    }
  };
}

export async function createRepoRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx, { write: true });
  if ("response" in auth) return auth.response;
  const { session, visibilityGrant } = auth;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      platform?: unknown;
      installationId?: unknown;
      repoName?: string;
    };
    if (!isValidInstallationId(body.installationId)) {
      return Response.json(
        { error: "missing or invalid `installationId`" },
        { status: 400 },
      );
    }

    const config = deployConfig(ctx);
    const platform = resolveDeployPlatform(body.platform, config);
    if (!platform) return invalidPlatformResponse();
    const client = await managerClient(req, ctx);
    const project = await client.scaffold({
      platform,
      installationId: Number(body.installationId),
      templateRepo: config.templateRepo,
      repoName: body.repoName?.trim() || defaultRepoName(),
      githubUserId: session.githubUserId,
      private: config.createdRepoPrivate,
    });
    clearDeployReadCache();
    if (!project.repositoryLink || !project.installationId) {
      return Response.json(
        { error: "backend did not return a created project" },
        { status: 502 },
      );
    }
    return Response.json({
      ok: true,
      repo: project.repositoryLink,
      installationId: String(project.installationId),
      projectId: project.id,
      project,
    });
  } catch (err) {
    return failureResponse(err, deployErrorContext(req, "launch.create_repo"));
  }
}

export async function deploymentStatusRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx, { cliScope: "deployment:read" });
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const deploymentId = new URL(req.url).searchParams.get("deploymentId");
  if (!isValidDeploymentId(deploymentId)) {
    return Response.json(
      { error: "missing or invalid `deploymentId`" },
      { status: 400 },
    );
  }

  try {
    const config = deployConfig(ctx);
    const platform = resolveDeployPlatform(
      new URL(req.url).searchParams.get("platform") ?? undefined,
      config,
    );
    if (!platform) return invalidPlatformResponse();
    const client = await managerClient(req, ctx);
    // The backend resolves CI live per poll (by the deployment's recorded
    // commit, on the App installation token) and deep-links the run URL —
    // no client-side GitHub enrichment on top.
    const result = await client.status({
      platform,
      deploymentId,
      githubUserId: session.githubUserId,
    });
    return Response.json({
      ...result,
      releaseTags: deploymentTargets(result.deployment).map(
        (target) => target.releaseTag,
      ),
    });
  } catch (err) {
    return failureResponse(err, deployErrorContext(req, "launch.status"));
  }
}

export async function activateRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx, { write: true, cliScope: "activate" });
  if ("response" in auth) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      releaseTags?: unknown;
      projectId?: unknown;
      apps?: unknown;
      actor?: string;
      platform?: unknown;
    };
    if (!isValidReleaseTags(body.releaseTags)) {
      return Response.json(
        { error: "missing or invalid `releaseTags`" },
        { status: 400 },
      );
    }
    if (!isValidProjectId(body.projectId)) {
      return Response.json(
        { error: "missing or invalid `projectId`" },
        { status: 400 },
      );
    }
    if (
      !Array.isArray(body.apps) ||
      !body.apps.every((app) => typeof app === "string")
    ) {
      return Response.json(
        { error: "missing or invalid `apps`" },
        { status: 400 },
      );
    }

    const releaseTags = body.releaseTags;
    const apps = body.apps.map((app) => app.trim()).filter(Boolean);
    if (apps.length === 0 || apps.length !== releaseTags.length) {
      return Response.json(
        { error: "`apps` must match `releaseTags` length" },
        { status: 400 },
      );
    }

    const client = await managerClient(req, ctx);
    const { session } = auth;
    const project = await findOwnedProject(
      client,
      session.githubUserId,
      body.projectId,
    );
    if (!project) {
      return Response.json(
        { error: "project not found for this user" },
        { status: 404 },
      );
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
      githubToken: ctx.env.BUILD_GITHUB_TOKEN,
    });
    if (Object.keys(missingByApp).length > 0) {
      return Response.json(
        { error: "missing required secrets", missing: missingByApp },
        { status: 409 },
      );
    }
    const result = await client.activateUserProjectReleases({
      githubUserId: session.githubUserId,
      projectId: project.id,
      releaseTags,
      apps,
      actor: session.githubLogin,
    });
    clearDeployReadCache();
    return Response.json(result);
  } catch (err) {
    return failureResponse(err, deployErrorContext(req, "launch.activate"));
  }
}

export async function projectAppsRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const projectId = Number(new URL(req.url).searchParams.get("projectId"));
  if (!isValidProjectId(projectId)) {
    return Response.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }

  try {
    const client = await managerClient(req, ctx);
    const owner = await findOwnedProject(
      client,
      session.githubUserId,
      projectId,
    );
    if (!owner) {
      return Response.json(
        { error: "project not found for this user" },
        { status: 404 },
      );
    }
    const result = await client.listUserProjectApps({
      githubUserId: session.githubUserId,
      projectId: owner.id,
    });
    return Response.json(launchAppStatusesResult(owner.id, result.apps));
  } catch (err) {
    return failureResponse(err, deployErrorContext(req, "launch.apps"));
  }
}

export async function sdkStatusRoute(req: Request, ctx: BuildContext) {
  try {
    const client = await managerClient(req, ctx);
    const status = await readCache.serverTags.get(["server_tags"], () =>
      timedManagerRead("server_tags", () => client.serverTags()),
    );
    const requiredVersion = status.sdkVersion;
    return Response.json({
      ok: true,
      serverTags: status.serverTags,
      sdkStatus: {
        requiredVersion,
        status: requiredVersion ? "unknown" : "missing",
        fixCommand: requiredVersion
          ? `aomi-build sdk fix --backend ${sdkBackendUrl(ctx)}`
          : null,
      },
    });
  } catch (err) {
    return failureResponse(err, deployErrorContext(req, "launch.sdk_status"));
  }
}

export async function deploymentHistoryRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const params = new URL(req.url).searchParams;
  const projectId = Number(params.get("projectId"));
  if (!isValidProjectId(projectId)) {
    return Response.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }
  const limit = Number(params.get("limit") ?? "20");

  try {
    const client = await managerClient(req, ctx);
    const deployments = await client.listUserProjectDeployments({
      githubUserId: session.githubUserId,
      projectId,
      limit: Number.isSafeInteger(limit) && limit > 0 ? limit : undefined,
    });
    return Response.json({ deployments });
  } catch (err) {
    return failureResponse(err, deployErrorContext(req, "deployment.history"));
  }
}

export async function deploymentFeedRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const params = new URL(req.url).searchParams;
  const platform = params.get("platform")?.trim() || undefined;
  const limit = Number(params.get("limit") ?? "50");
  const cursorCreatedAt = params.get("cursorCreatedAt");
  const cursorId = params.get("cursorId");
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > 100 ||
    (cursorCreatedAt === null) !== (cursorId === null)
  ) {
    return Response.json(
      { error: "invalid deployment feed pagination" },
      { status: 400 },
    );
  }
  const cursor =
    cursorCreatedAt !== null && cursorId !== null
      ? { createdAt: Number(cursorCreatedAt), id: Number(cursorId) }
      : null;
  if (
    cursor &&
    (!Number.isSafeInteger(cursor.createdAt) ||
      !Number.isSafeInteger(cursor.id))
  ) {
    return Response.json(
      { error: "invalid deployment feed cursor" },
      { status: 400 },
    );
  }

  try {
    const client = await managerClient(req, ctx);
    const page = await client.listUserDeployments({
      githubUserId: session.githubUserId,
      platform,
      limit,
      cursor,
    });
    return Response.json(page);
  } catch (err) {
    return failureResponse(err, deployErrorContext(req, "deployment.feed"));
  }
}

export async function deploymentSecretsRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const params = new URL(req.url).searchParams;
  const applicationId = Number(params.get("applicationId"));
  if (!isValidApplicationId(applicationId)) {
    return Response.json(
      { error: "missing or invalid `applicationId`" },
      { status: 400 },
    );
  }

  try {
    const client = await managerClient(req, ctx);
    const { application } = await client.getBuilderApplication({
      githubUserId: session.githubUserId,
      applicationId,
    });
    const { byApp } = await client.listAppSecrets({
      applicationId,
    });
    return Response.json({
      byApp: { [application.name]: byApp[application.name] ?? [] },
    });
  } catch (err) {
    return failureResponse(err, deployErrorContext(req, "deployment.secrets_read"));
  }
}

export async function deploymentSecretsWriteRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx, { write: true });
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as {
    applicationId?: unknown;
    secrets?: unknown;
  };
  if (!isValidApplicationId(body.applicationId)) {
    return Response.json(
      { error: "missing or invalid `applicationId`" },
      { status: 400 },
    );
  }
  // Accept a { KEY: value } map of non-empty string values.
  const secrets: Record<string, string> = {};
  if (body.secrets && typeof body.secrets === "object") {
    for (const [k, v] of Object.entries(
      body.secrets as Record<string, unknown>,
    )) {
      const key = k.trim();
      if (key && typeof v === "string" && v.length > 0) secrets[key] = v;
    }
  }
  if (Object.keys(secrets).length === 0) {
    return Response.json(
      { error: "no valid secrets provided" },
      { status: 400 },
    );
  }

  try {
    const client = await managerClient(req, ctx);
    const { application } = await client.getBuilderApplication({
      githubUserId: session.githubUserId,
      applicationId: body.applicationId,
    });
    const { handles } = await client.ingestSecrets({
      applicationId: body.applicationId,
      app: application.name,
      secrets,
    });
    return Response.json(
      { ok: true, keys: Object.keys(handles) },
      { status: 202 },
    );
  } catch (err) {
    return failureResponse(err, deployErrorContext(req, "deployment.secrets_write"));
  }
}

export async function deploymentSecretsDeleteRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx, { write: true });
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as {
    applicationId?: unknown;
    name?: unknown;
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "missing `name`" }, { status: 400 });
  }
  if (!isValidApplicationId(body.applicationId)) {
    return Response.json(
      { error: "missing or invalid `applicationId`" },
      { status: 400 },
    );
  }

  try {
    const client = await managerClient(req, ctx);
    await client.getBuilderApplication({
      githubUserId: session.githubUserId,
      applicationId: body.applicationId,
    });
    const removed = await client.removeAppSecret({
      applicationId: body.applicationId,
      name,
    });
    return Response.json({ ok: true, removed });
  } catch (err) {
    return failureResponse(err, deployErrorContext(req, "deployment.secrets_delete"));
  }
}

export async function deploymentRecordsRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const params = new URL(req.url).searchParams;
  const app = params.get("app")?.trim();
  if (!app) {
    return Response.json({ error: "missing `app`" }, { status: 400 });
  }
  const projectId = Number(params.get("projectId"));
  if (!isValidProjectId(projectId)) {
    return Response.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }

  try {
    const client = await managerClient(req, ctx);
    const project = await findOwnedProject(
      client,
      session.githubUserId,
      projectId,
    );
    if (!project || !project.apps.some((candidate) => candidate.name === app)) {
      return Response.json(
        { error: "app not found for this user" },
        { status: 404 },
      );
    }
    const result = await client.listDeploymentRecords({
      platform: projectPlatform(project),
      app,
      projectId,
    });
    return Response.json(result);
  } catch (err) {
    return failureResponse(err, deployErrorContext(req, "deployment.records"));
  }
}

export async function deploymentPromoteRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx, { write: true });
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as {
    deploymentId?: unknown;
    projectId?: unknown;
    apps?: unknown;
    actor?: string;
    platform?: unknown;
  };
  if (!isValidDeploymentId(body.deploymentId)) {
    return Response.json(
      { error: "missing or invalid `deploymentId`" },
      { status: 400 },
    );
  }
  if (!isValidProjectId(body.projectId)) {
    return Response.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }
  const deploymentId = body.deploymentId;
  const projectId = body.projectId;
  const apps =
    Array.isArray(body.apps) &&
    body.apps.every((app) => typeof app === "string")
      ? body.apps.map((app) => app.trim()).filter(Boolean)
      : undefined;

  try {
    const client = await managerClient(req, ctx);

    // Authorize the signed-in user at the Project boundary first; the exact
    // deployment projection below then proves candidate ownership.
    const project = await findOwnedProject(
      client,
      session.githubUserId,
      projectId,
    );
    if (!project) {
      return Response.json(
        { error: "project not found for this user" },
        { status: 404 },
      );
    }
    const deployment = await client.getUserProjectDeployment({
      githubUserId: session.githubUserId,
      projectId,
      deploymentId,
    });
    if (!deployment) {
      return Response.json(
        { error: "deployment does not belong to this project" },
        { status: 404 },
      );
    }

    // Candidate ownership and release pairs come from the exact deployment
    // projection. Promotion history is empty before the first promote and is
    // therefore never an authorization source or a secret-gate source.
    const selectedApps = apps ?? deployment.apps.map((app) => app.name);
    const pairs = deployment.apps.flatMap((app) =>
      selectedApps.includes(app.name) && app.releaseTag
        ? [{ app: app.name, releaseTag: app.releaseTag }]
        : [],
    );
    if (pairs.length !== selectedApps.length) {
      return Response.json(
        { error: "deployment does not contain all requested apps" },
        { status: 404 },
      );
    }
    const missingByApp = await missingSecretsForActivation({
      client,
      githubUserId: session.githubUserId,
      project,
      pairs,
      githubToken: ctx.env.BUILD_GITHUB_TOKEN,
    });
    if (Object.keys(missingByApp).length > 0) {
      return Response.json(
        { error: "missing required secrets", missing: missingByApp },
        { status: 409 },
      );
    }

    // Default the promotion actor to the signed-in GitHub user so Aomi Build
    // promotions are attributable without the client threading it.
    const actor = session.githubLogin;
    const result = await client.promoteUserProjectDeployment({
      githubUserId: session.githubUserId,
      projectId,
      deploymentId,
      mode: "targeted",
      apps: selectedApps,
      actor,
    });
    clearDeployReadCache();
    return Response.json(result, { status: result.ok ? 202 : 409 });
  } catch (err) {
    return failureResponse(err, deployErrorContext(req, "deployment.promote"));
  }
}

export async function deploymentDeactivateRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx, { write: true });
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as {
    projectId?: unknown;
    apps?: unknown;
    actor?: string;
    platform?: unknown;
  };
  if (!isValidProjectId(body.projectId)) {
    return Response.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }
  const apps =
    Array.isArray(body.apps) && body.apps.every((a) => typeof a === "string")
      ? body.apps.map((a) => a.trim()).filter(Boolean)
      : [];
  if (apps.length === 0) {
    return Response.json(
      { error: "missing or invalid `apps`" },
      { status: 400 },
    );
  }

  try {
    const config = deployConfig(ctx);
    const client = await managerClient(req, ctx);
    const project = await findOwnedProject(
      client,
      session.githubUserId,
      body.projectId,
    );
    if (!project) {
      return Response.json(
        { error: "project not found for this user" },
        { status: 404 },
      );
    }
    const platform = projectPlatform(project);
    const actor = session.githubLogin;
    const applications = apps.flatMap((name) => {
      const application = project.apps.find(
        (candidate) => candidate.name === name,
      );
      return application ? [application] : [];
    });
    if (applications.length !== apps.length) {
      return Response.json(
        { error: "application not found in project" },
        { status: 404 },
      );
    }
    for (const application of applications) {
      await client.deactivateApplication({
        platform,
        applicationId: application.id,
        app: application.name,
        actor,
      });
    }
    clearDeployReadCache();
    return Response.json({ ok: true, apps }, { status: 202 });
  } catch (err) {
    return failureResponse(err, deployErrorContext(req, "deployment.deactivate"));
  }
}

export async function redeployRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx, { write: true });
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isValidProjectId(body.projectId)) {
    return Response.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }

  try {
    const config = deployConfig(ctx);
    const client = await managerClient(req, ctx);
    const project = await findOwnedProject(
      client,
      session.githubUserId,
      body.projectId,
    );
    if (!project) {
      return Response.json(
        { error: "project not found for this user" },
        { status: 404 },
      );
    }
    const latest = await client.getUserProjectLatestDeployment({
      githubUserId: session.githubUserId,
      projectId: body.projectId,
    });
    const deploymentId = latest?.deploymentId ?? null;
    if (!deploymentId) {
      return Response.json(
        {
          error:
            "No backend-owned deployment is available for this project yet; refusing to reuse Deploy because GitHub can skip tree-identical pushes.",
        },
        { status: 409 },
      );
    }

    // The backend re-runs the Actions run behind the deployment's recorded
    // commit on its App installation token; no GitHub token in this layer.
    const rerun = await client.rerunDeployment({
      platform: projectPlatform(project),
      deploymentId,
      githubUserId: session.githubUserId,
    });
    clearDeployReadCache();
    return Response.json({
      ok: rerun.ok,
      projectId: body.projectId,
      platformRepo: latest?.platformRepo ?? null,
      ciRunId: rerun.runId === null ? null : String(rerun.runId),
      ciUrl: rerun.ciUrl ?? latest?.ciUrl ?? null,
    });
  } catch (err) {
    return failureResponse(err, deployErrorContext(req, "deployment.redeploy"));
  }
}

// GET /api/bff/launch/projects — the signed-in user's projects + their apps,
// merged across installations and platforms unless `platform` is explicit.
// Scoped to the github_user_id in the session cookie; a client can never
// request someone else's projects. `projectId` narrows the response to one
// project through the manager's canonical detail read, including the current
// revision-specific ProjectConfiguration.
export async function userProjectsRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx);
  if ("response" in auth) return auth.response;
  const { session, visibilityGrant } = auth;

  try {
    const config = deployConfig(ctx);
    const params = new URL(req.url).searchParams;
    const requestedPlatform = params.get("platform");
    const platform =
      requestedPlatform === null
        ? undefined
        : resolveDeployPlatform(requestedPlatform, config);
    if (requestedPlatform !== null && !platform) {
      return invalidPlatformResponse();
    }
    const requestedProjectId = params.get("projectId");
    const projectId =
      requestedProjectId === null ? undefined : Number(requestedProjectId);
    if (projectId !== undefined && !isValidProjectId(projectId)) {
      return Response.json(
        { error: "invalid `projectId`" },
        { status: 400 },
      );
    }
    // Platform is a list filter only. Once the caller supplies a canonical
    // Project ID, ownership and platform binding come from that Project.
    const listPlatform =
      projectId === undefined ? (platform ?? undefined) : undefined;
    const client = await managerClient(req, ctx);
    const listProjects = (platform?: string) =>
      readCache.projects.get(
        [session.githubUserId, platform ?? null, visibilityGrant ?? ""],
        () =>
          timedManagerRead("list_user_projects", () =>
            client.listUserProjects({
              githubUserId: session.githubUserId,
              platform,
              ...(visibilityGrant ? { visibilityGrant } : {}),
            }),
          ),
      );
    const projects =
      projectId === undefined
        ? await listProjects(listPlatform)
        : [
            await readCache.projectDetails.get(
              [session.githubUserId, projectId, visibilityGrant ?? ""],
              async () => {
                const project = await timedManagerRead("get_user_project", () =>
                  client.getUserProject({
                    githubUserId: session.githubUserId,
                    projectId,
                    ...(visibilityGrant ? { visibilityGrant } : {}),
                  }),
                );
                // The manager's detail read never stamps the live SDK summary
                // its list read carries (`sdk_version` / `sdk_versions`, from
                // the active promotion records), so a project page fetched on
                // its own read "SDK unknown" while the Projects index called
                // the same project outdated. Fill the gap from the same list
                // derivation; once the manager stamps it on the detail this is
                // a no-op. Only live apps carry a runtime SDK, so skip the
                // extra read for everything else.
                const stamped =
                  project.sdkVersion != null ||
                  (project.sdkVersions?.length ?? 0) > 0;
                const live = project.apps.some(
                  (app) => app.isActive && app.appReleaseTag != null,
                );
                if (stamped || !live) return project;
                const listed = (await listProjects()).find(
                  (row) => row.id === projectId,
                );
                return listed
                  ? {
                      ...project,
                      sdkVersion: listed.sdkVersion ?? null,
                      sdkVersions: listed.sdkVersions ?? [],
                      ffiVersion: listed.ffiVersion ?? null,
                      ffiVersions: listed.ffiVersions ?? [],
                      requiredFfiVersion: listed.requiredFfiVersion ?? null,
                      ffiUnrecorded: listed.ffiUnrecorded ?? false,
                      ffiIncompatible: listed.ffiIncompatible ?? false,
                      ffiUnverifiedSdkVersions:
                        listed.ffiUnverifiedSdkVersions ?? [],
                    }
                  : project;
              },
            ),
          ];
    return Response.json({
      projects,
      githubLogin: session.githubLogin,
    });
  } catch (err) {
    return failureResponse(err, deployErrorContext(req, "deployment.projects"));
  }
}

// GET /api/bff/deployments/required-secrets?projectId=<n> — the Manager's
// DB-backed secret declarations for each live release plus which required slots
// are still unfilled in the vault. Never returns secret VALUES.
export async function requiredSecretsRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const projectId = Number(new URL(req.url).searchParams.get("projectId"));
  if (!isValidProjectId(projectId)) {
    return Response.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }

  try {
    const client = await managerClient(req, ctx);
    const declared = await client.getUserProjectRequiredSecrets({
      githubUserId: session.githubUserId,
      projectId,
    });
    const entries = await Promise.all(
      Object.entries(declared.byApp).map(
        async ([app, { applicationId, slots }]) => {
          const configured = await client.listAppSecrets({
            applicationId,
          });
          const configuredKeys = (configured.byApp[app] ?? []).map(
            (handle) => handle.split("::").pop() ?? handle,
          );
          return [
            app,
            {
              applicationId,
              slots: builderSecretSlots(slots),
              missing: missingRequiredSecrets(slots, configuredKeys).map(
                (slot) => slot.name,
              ),
            },
          ] as const;
        },
      ),
    );

    return Response.json({ byApp: Object.fromEntries(entries) });
  } catch (err) {
    if (err instanceof BackendError) {
      if (err.status === 404) {
        return Response.json(
          { error: "project not found for this user" },
          { status: 404 },
        );
      }
      return failureResponse(
        new RequiredSecretsCheckError({
          cause: err,
          reason: "backend_unavailable",
          upstream: "rust",
          upstreamStatus: err.status,
        }),
        deployErrorContext(req, "deployment.required_secrets"),
      );
    }
    return failureResponse(err, deployErrorContext(req, "deployment.required_secrets"));
  }
}

// GET  /api/bff/deployments/app-key?applicationId=  -> { appKey | null }
// POST /api/bff/deployments/app-key; JSON: { applicationId } -> { appKey }
// The key a builder shares so others can use a private application in Chat.
// GET shows the current key; POST issues a new one and revokes the old. The
// manager proves the signed-in builder owns the application's Project.
export async function appKeyRoute(req: Request, ctx: BuildContext) {
  const regenerate = req.method === "POST";
  const auth = await authorize(req, ctx, { write: regenerate });
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const applicationId = regenerate
    ? ((await req.json().catch(() => ({}))) as Record<string, unknown>)
        .applicationId
    : Number(new URL(req.url).searchParams.get("applicationId"));
  if (!isValidApplicationId(applicationId)) {
    return Response.json(
      { error: "invalid `applicationId`" },
      { status: 400 },
    );
  }

  try {
    const client = await managerClient(req, ctx);
    const input = {
      githubUserId: session.githubUserId,
      applicationId,
      actor: session.githubLogin,
    };
    const appKey = regenerate
      ? await client.regenerateBuilderAppKey(input)
      : await client.getBuilderAppKey(input);
    return Response.json(
      { appKey },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) {
      return Response.json(
        { error: "application not found for this user" },
        { status: 404 },
      );
    }
    return failureResponse(err, deployErrorContext(req, "deployment.app_key"));
  }
}

export async function deploymentAttemptsRoute(req: Request, ctx: BuildContext) {
  const write = req.method === "POST";
  const auth = await authorize(req, ctx, {
    write,
    cliScope: write ? "deploy" : "deployment:read",
  });
  if ("response" in auth) return auth.response;
  const input = write
    ? await req.json().catch(() => null)
    : Object.fromEntries(new URL(req.url).searchParams);
  const projectId = Number(input?.projectId);
  const runId = input?.runId === undefined ? undefined : Number(input.runId);
  const page = input?.page === undefined ? undefined : Number(input.page);
  if (
    !Number.isSafeInteger(projectId) ||
    projectId <= 0 ||
    (runId !== undefined && (!Number.isSafeInteger(runId) || runId <= 0)) ||
    (page !== undefined &&
      (!Number.isSafeInteger(page) || page < 1 || page > 10000)) ||
    (input?.branch !== undefined &&
      (typeof input.branch !== "string" || input.branch.length > 120))
  ) {
    return Response.json(
      { error: "Invalid deployment request" },
      { status: 400 },
    );
  }
  try {
    const client = await managerClient(req, ctx);
    const scope = { projectId, githubUserId: auth.session.githubUserId };
    const result = !write
      ? await client.projectDeploymentAttempts({ ...scope, runId, page })
      : input.action === "cancel" && runId !== undefined
        ? await client.cancelProjectDeploymentAttempt({ ...scope, runId })
        : input.action === "start"
          ? await client.startProjectDeploymentAttempt({
              ...scope,
              branch: input.branch,
            })
          : null;
    if (!result)
      return Response.json(
        { error: "Invalid deployment action" },
        { status: 400 },
      );
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failureResponse(error, {
        routeFamily: "/api/bff/launch/attempts",
        operation: "launch.attempts",
        method: req.method,
      });
  }
}

/** Builder-owned source repository access. A GET has no CSRF gate. */
export async function githubAppInstallationsRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  // Ownership identity is the session's alone — never a query parameter.
  try {
    const client = await managerClient(req, ctx);
    const result = await client.listUserGitHubAppInstallations({
      githubUserId: session.githubUserId,
    });
    // Permission state changes out of band (an org owner accepting a
    // request on GitHub); a cached answer here would keep saying "missing".
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const failure = failureResponse(error, {
        routeFamily: new URL(req.url).pathname,
        operation: "deployment.github_app_installations",
        method: req.method,
      });
    return Response.json(
      { error: "Couldn’t check GitHub repository access. Try again." },
      { status: failure.status },
    );
  }
}

export async function projectSdkUpgradeRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx, { write: true });
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const body: unknown = await req.json().catch(() => null);
  const projectId = Number(
    body && typeof body === "object" && "projectId" in body
      ? body.projectId
      : undefined,
  );
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return Response.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }

  try {
    const client = await managerClient(req, ctx);
    const result = await client.upgradeUserProjectSdk({
      projectId,
      githubUserId: session.githubUserId,
    });
    // The upgrade mutates the project repo; the merged PR changes the
    // project's stamped SDK version, which the cached project list carries.
    clearDeployReadCache();
    return Response.json(result);
  } catch (error) {
    return failureResponse(error, {
        routeFamily: new URL(req.url).pathname,
        operation: "deployment.sdk_upgrade",
        method: req.method,
      });
  }
}

/**
 * Read-only merge poll for the upgrade PR — the cheap counterpart to
 * {@link projectSdkUpgradeRoute}. A GET, so no CSRF/origin gate; the backend
 * answers with a single GitHub call (no repo tarball, no branch mutation),
 * making it safe for the launch flow's 45s recheck loop.
 */
export async function projectSdkUpgradeStatusRoute(req: Request, ctx: BuildContext) {
  const auth = await authorize(req, ctx);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const projectId = Number(
    new URL(req.url).searchParams.get("projectId") ?? undefined,
  );
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return Response.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }

  try {
    const client = await managerClient(req, ctx);
    const result = await client.sdkUpgradeStatus({
      projectId,
      githubUserId: session.githubUserId,
    });
    return Response.json(result);
  } catch (error) {
    return failureResponse(error, {
        routeFamily: new URL(req.url).pathname,
        operation: "deployment.sdk_upgrade_status",
        method: req.method,
      });
  }
}
