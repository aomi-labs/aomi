import "server-only";

import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { backendClient } from "@build/server/bff/backend";
import { TimedPromiseCache } from "@build/server/bff/timed-promise-cache";
import { configuredBackendUrl } from "@build/server/backend-url";
import { buildFailures } from "@build/server/bff/failures";
import { launchConfig, resolveLaunchPlatform } from "./config";
import {
  launchAppStatusesResult,
  missingSecretsForActivation,
  RequiredSecretsCheckError,
} from "@aomi-labs/deploy/bff";
import {
  BackendError,
  builderSecretSlots,
  missingRequiredSecrets,
} from "@aomi-labs/deploy";
import { deploymentTargets } from "@aomi-labs/deploy/launch";
import {
  isValidDeploymentId,
  isValidInstallationId,
  isValidReleaseTags,
  isValidRepo,
} from "@build/lib/validate-input";
import { authorize } from "@build/server/bff/auth";

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
      `launch bff: ${label} took ${Math.round(performance.now() - startedAt)}ms`,
    );
  }
}

type BackendClientInstance = Awaited<ReturnType<typeof backendClient>>;

function launchErrorContext(req: Request, operation: string) {
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
// read-only routes, launch mutations CHANGE what these reads return (preflight
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

export function clearLaunchReadCache() {
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
  const projects = await cachedUserProjects(client, githubUserId);
  return projects.find((project) => project.id === projectId) ?? null;
}

function defaultRepoName() {
  const normalized = CREATED_REPO_PREFIX.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${normalized}-${randomBytes(4).toString("hex")}`;
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
  configured: ReturnType<typeof launchConfig>,
): string | null {
  return resolveLaunchPlatform(
    new URL(req.url).searchParams.get("platform") ?? undefined,
    configured,
  );
}

function invalidPlatformResponse(): NextResponse {
  return NextResponse.json(
    { error: "unknown or unavailable `platform`" },
    { status: 400 },
  );
}

export function launchDeployRoute(preflight: boolean) {
  return async function POST(req: Request): Promise<Response> {
    const auth = await authorize(req, { write: true, cliScope: "deploy" });
    if ("response" in auth) return auth.response;
    const { session } = auth;

    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (body.projectId !== undefined && !isValidProjectId(body.projectId)) {
      return NextResponse.json(
        { error: "invalid `projectId`" },
        { status: 400 },
      );
    }
    if (body.repo !== undefined && !isValidRepo(body.repo)) {
      return NextResponse.json({ error: "invalid `repo`" }, { status: 400 });
    }
    const repo = isValidRepo(body.repo) ? body.repo : undefined;

    try {
      const client = await backendClient();

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
          return NextResponse.json(
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
          return NextResponse.json(
            {
              error:
                "repository is not connected as a Project; run `aomi-build project create` first",
            },
            { status: 404 },
          );
        }
        projectId = project.id;
      } else {
        return NextResponse.json(
          {
            error: preflight
              ? "missing `projectId` or `repo`"
              : "missing `projectId`",
          },
          { status: 400 },
        );
      }

      if (!preflight && !deploySourceRef) {
        return NextResponse.json(
          { error: "missing source commit from preflight" },
          { status: 400 },
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
      // Preflight re-syncs the source (and can register new apps); deploy
      // records a new deployment. The next projects read must see it.
      clearLaunchReadCache();
      const projectUrl = new URL(`/projects/${projectId}`, req.url);
      projectUrl.searchParams.set("tab", "deployments");
      const targets = deploymentTargets(deployment);
      return NextResponse.json(
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
      return buildFailures.handle({
        source: "launch",
        error: err,
        context: launchErrorContext(
          req,
          preflight ? "launch.preflight" : "launch.deploy",
        ),
      }).response;
    }
  };
}

export async function createLaunchRepoRoute(req: Request) {
  const auth = await authorize(req, { write: true });
  if ("response" in auth) return auth.response;
  const { session, visibilityGrant } = auth;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      platform?: unknown;
      installationId?: unknown;
      repoName?: string;
    };
    if (!isValidInstallationId(body.installationId)) {
      return NextResponse.json(
        { error: "missing or invalid `installationId`" },
        { status: 400 },
      );
    }

    const config = launchConfig();
    const platform = resolveLaunchPlatform(body.platform, config);
    if (!platform) return invalidPlatformResponse();
    const client = await backendClient();
    const project = await client.scaffold({
      platform,
      installationId: Number(body.installationId),
      templateRepo: config.templateRepo,
      repoName: body.repoName?.trim() || defaultRepoName(),
      githubUserId: session.githubUserId,
      private: config.createdRepoPrivate,
    });
    clearLaunchReadCache();
    if (!project.repositoryLink || !project.installationId) {
      return NextResponse.json(
        { error: "backend did not return a created project" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      repo: project.repositoryLink,
      installationId: String(project.installationId),
      projectId: project.id,
      project,
    });
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "launch.create_repo"),
    }).response;
  }
}

export async function launchStatusRoute(req: Request) {
  const auth = await authorize(req, { cliScope: "deployment:read" });
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const deploymentId = new URL(req.url).searchParams.get("deploymentId");
  if (!isValidDeploymentId(deploymentId)) {
    return NextResponse.json(
      { error: "missing or invalid `deploymentId`" },
      { status: 400 },
    );
  }

  try {
    const config = launchConfig();
    const platform = resolveLaunchPlatform(
      new URL(req.url).searchParams.get("platform") ?? undefined,
      config,
    );
    if (!platform) return invalidPlatformResponse();
    const client = await backendClient();
    // The backend resolves CI live per poll (by the deployment's recorded
    // commit, on the App installation token) and deep-links the run URL —
    // no client-side GitHub enrichment on top.
    const result = await client.status({
      platform,
      deploymentId,
      githubUserId: session.githubUserId,
    });
    return NextResponse.json({
      ...result,
      releaseTags: deploymentTargets(result.deployment).map(
        (target) => target.releaseTag,
      ),
    });
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "launch.status"),
    }).response;
  }
}

export async function activateLaunchRoute(req: Request) {
  const auth = await authorize(req, { write: true, cliScope: "activate" });
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
      return NextResponse.json(
        { error: "missing or invalid `releaseTags`" },
        { status: 400 },
      );
    }
    if (!isValidProjectId(body.projectId)) {
      return NextResponse.json(
        { error: "missing or invalid `projectId`" },
        { status: 400 },
      );
    }
    if (
      !Array.isArray(body.apps) ||
      !body.apps.every((app) => typeof app === "string")
    ) {
      return NextResponse.json(
        { error: "missing or invalid `apps`" },
        { status: 400 },
      );
    }

    const releaseTags = body.releaseTags;
    const apps = body.apps.map((app) => app.trim()).filter(Boolean);
    if (apps.length === 0 || apps.length !== releaseTags.length) {
      return NextResponse.json(
        { error: "`apps` must match `releaseTags` length" },
        { status: 400 },
      );
    }

    const client = await backendClient();
    const { session } = auth;
    const project = await findOwnedProject(
      client,
      session.githubUserId,
      body.projectId,
    );
    if (!project) {
      return NextResponse.json(
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
    });
    if (Object.keys(missingByApp).length > 0) {
      return NextResponse.json(
        { error: "missing required secrets", missing: missingByApp },
        { status: 409 },
      );
    }
    const result = await client.activateUserProjectReleases({
      githubUserId: session.githubUserId,
      projectId: project.id,
      releaseTags,
      apps,
      actor: typeof body.actor === "string" ? body.actor : undefined,
    });
    clearLaunchReadCache();
    return NextResponse.json(result);
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "launch.activate"),
    }).response;
  }
}

export async function launchAppsRoute(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const projectId = Number(new URL(req.url).searchParams.get("projectId"));
  if (!isValidProjectId(projectId)) {
    return NextResponse.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }

  try {
    const client = await backendClient();
    const owner = await findOwnedProject(
      client,
      session.githubUserId,
      projectId,
    );
    if (!owner) {
      return NextResponse.json(
        { error: "project not found for this user" },
        { status: 404 },
      );
    }
    const result = await client.listUserProjectApps({
      githubUserId: session.githubUserId,
      projectId: owner.id,
    });
    return NextResponse.json(launchAppStatusesResult(owner.id, result.apps));
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "launch.apps"),
    }).response;
  }
}

export async function launchSdkStatusRoute(req: Request) {
  try {
    const client = await backendClient();
    const status = await readCache.serverTags.get(["server_tags"], () =>
      timedManagerRead("server_tags", () => client.serverTags()),
    );
    const requiredVersion = status.sdkVersion;
    return NextResponse.json({
      ok: true,
      serverTags: status.serverTags,
      sdkStatus: {
        requiredVersion,
        status: requiredVersion ? "unknown" : "missing",
        fixCommand: requiredVersion
          ? `aomi-build sdk fix --backend ${configuredBackendUrl()}`
          : null,
      },
    });
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "launch.sdk_status"),
    }).response;
  }
}

export const deploymentProjectsRoute = userProjectsRoute;
export const deploymentStatusRoute = launchStatusRoute;
export const deploymentDeployRoute = launchDeployRoute;
export const deploymentRedeployRoute = redeployLaunchRoute;

export async function deploymentHistoryRoute(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const params = new URL(req.url).searchParams;
  const projectId = Number(params.get("projectId"));
  if (!isValidProjectId(projectId)) {
    return NextResponse.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }
  const limit = Number(params.get("limit") ?? "20");

  try {
    const client = await backendClient();
    const deployments = await client.listUserProjectDeployments({
      githubUserId: session.githubUserId,
      projectId,
      limit: Number.isSafeInteger(limit) && limit > 0 ? limit : undefined,
    });
    return NextResponse.json({ deployments });
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "deployment.history"),
    }).response;
  }
}

export async function deploymentFeedRoute(req: Request) {
  const auth = await authorize(req);
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
    return NextResponse.json(
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
    return NextResponse.json(
      { error: "invalid deployment feed cursor" },
      { status: 400 },
    );
  }

  try {
    const client = await backendClient();
    const page = await client.listUserDeployments({
      githubUserId: session.githubUserId,
      platform,
      limit,
      cursor,
    });
    return NextResponse.json(page);
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "deployment.feed"),
    }).response;
  }
}

export async function deploymentSecretsRoute(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const params = new URL(req.url).searchParams;
  const applicationId = Number(params.get("applicationId"));
  if (!isValidApplicationId(applicationId)) {
    return NextResponse.json(
      { error: "missing or invalid `applicationId`" },
      { status: 400 },
    );
  }

  try {
    const client = await backendClient();
    const { application } = await client.getBuilderApplication({
      githubUserId: session.githubUserId,
      applicationId,
    });
    const { byApp } = await client.listAppSecrets({
      applicationId,
    });
    return NextResponse.json({
      byApp: { [application.name]: byApp[application.name] ?? [] },
    });
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "deployment.secrets_read"),
    }).response;
  }
}

export async function deploymentSecretsWriteRoute(req: Request) {
  const auth = await authorize(req, { write: true });
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as {
    applicationId?: unknown;
    secrets?: unknown;
  };
  if (!isValidApplicationId(body.applicationId)) {
    return NextResponse.json(
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
    return NextResponse.json(
      { error: "no valid secrets provided" },
      { status: 400 },
    );
  }

  try {
    const client = await backendClient();
    const { application } = await client.getBuilderApplication({
      githubUserId: session.githubUserId,
      applicationId: body.applicationId,
    });
    const { handles } = await client.ingestSecrets({
      applicationId: body.applicationId,
      app: application.name,
      secrets,
    });
    return NextResponse.json(
      { ok: true, keys: Object.keys(handles) },
      { status: 202 },
    );
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "deployment.secrets_write"),
    }).response;
  }
}

export async function deploymentSecretsDeleteRoute(req: Request) {
  const auth = await authorize(req, { write: true });
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as {
    applicationId?: unknown;
    name?: unknown;
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "missing `name`" }, { status: 400 });
  }
  if (!isValidApplicationId(body.applicationId)) {
    return NextResponse.json(
      { error: "missing or invalid `applicationId`" },
      { status: 400 },
    );
  }

  try {
    const client = await backendClient();
    await client.getBuilderApplication({
      githubUserId: session.githubUserId,
      applicationId: body.applicationId,
    });
    const removed = await client.removeAppSecret({
      applicationId: body.applicationId,
      name,
    });
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "deployment.secrets_delete"),
    }).response;
  }
}

export async function deploymentRecordsRoute(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const params = new URL(req.url).searchParams;
  const app = params.get("app")?.trim();
  if (!app) {
    return NextResponse.json({ error: "missing `app`" }, { status: 400 });
  }
  const projectId = Number(params.get("projectId"));
  if (!isValidProjectId(projectId)) {
    return NextResponse.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }

  try {
    const client = await backendClient();
    const project = await findOwnedProject(
      client,
      session.githubUserId,
      projectId,
    );
    if (!project || !project.apps.some((candidate) => candidate.name === app)) {
      return NextResponse.json(
        { error: "app not found for this user" },
        { status: 404 },
      );
    }
    const result = await client.listDeploymentRecords({
      platform: projectPlatform(project),
      app,
      projectId,
    });
    return NextResponse.json(result);
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "deployment.records"),
    }).response;
  }
}

export async function deploymentPromoteRoute(req: Request) {
  const auth = await authorize(req, { write: true });
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
    return NextResponse.json(
      { error: "missing or invalid `deploymentId`" },
      { status: 400 },
    );
  }
  if (!isValidProjectId(body.projectId)) {
    return NextResponse.json(
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
    const client = await backendClient();

    // Authorize the signed-in user at the Project boundary first; the exact
    // deployment projection below then proves candidate ownership.
    const project = await findOwnedProject(
      client,
      session.githubUserId,
      projectId,
    );
    if (!project) {
      return NextResponse.json(
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
      return NextResponse.json(
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
      return NextResponse.json(
        { error: "deployment does not contain all requested apps" },
        { status: 404 },
      );
    }
    const missingByApp = await missingSecretsForActivation({
      client,
      githubUserId: session.githubUserId,
      project,
      pairs,
    });
    if (Object.keys(missingByApp).length > 0) {
      return NextResponse.json(
        { error: "missing required secrets", missing: missingByApp },
        { status: 409 },
      );
    }

    // Default the promotion actor to the signed-in GitHub user so Aomi Build
    // promotions are attributable without the client threading it.
    const actor =
      typeof body.actor === "string" && body.actor.trim()
        ? body.actor
        : session.githubLogin;
    const result = await client.promoteUserProjectDeployment({
      githubUserId: session.githubUserId,
      projectId,
      deploymentId,
      mode: "targeted",
      apps: selectedApps,
      actor,
    });
    clearLaunchReadCache();
    return NextResponse.json(result, { status: result.ok ? 202 : 409 });
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "deployment.promote"),
    }).response;
  }
}

export async function deploymentDeactivateRoute(req: Request) {
  const auth = await authorize(req, { write: true });
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as {
    projectId?: unknown;
    apps?: unknown;
    actor?: string;
    platform?: unknown;
  };
  if (!isValidProjectId(body.projectId)) {
    return NextResponse.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }
  const apps =
    Array.isArray(body.apps) && body.apps.every((a) => typeof a === "string")
      ? body.apps.map((a) => a.trim()).filter(Boolean)
      : [];
  if (apps.length === 0) {
    return NextResponse.json(
      { error: "missing or invalid `apps`" },
      { status: 400 },
    );
  }

  try {
    const config = launchConfig();
    const client = await backendClient();
    const project = await findOwnedProject(
      client,
      session.githubUserId,
      body.projectId,
    );
    if (!project) {
      return NextResponse.json(
        { error: "project not found for this user" },
        { status: 404 },
      );
    }
    const platform = projectPlatform(project);
    const actor =
      typeof body.actor === "string" && body.actor.trim()
        ? body.actor
        : session.githubLogin;
    const applications = apps.flatMap((name) => {
      const application = project.apps.find(
        (candidate) => candidate.name === name,
      );
      return application ? [application] : [];
    });
    if (applications.length !== apps.length) {
      return NextResponse.json(
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
    clearLaunchReadCache();
    return NextResponse.json({ ok: true, apps }, { status: 202 });
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "deployment.deactivate"),
    }).response;
  }
}

export async function redeployLaunchRoute(req: Request) {
  const auth = await authorize(req, { write: true });
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isValidProjectId(body.projectId)) {
    return NextResponse.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }

  try {
    const config = launchConfig();
    const client = await backendClient();
    const project = await findOwnedProject(
      client,
      session.githubUserId,
      body.projectId,
    );
    if (!project) {
      return NextResponse.json(
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
      return NextResponse.json(
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
    clearLaunchReadCache();
    return NextResponse.json({
      ok: rerun.ok,
      projectId: body.projectId,
      platformRepo: latest?.platformRepo ?? null,
      ciRunId: rerun.runId === null ? null : String(rerun.runId),
      ciUrl: rerun.ciUrl ?? latest?.ciUrl ?? null,
    });
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "deployment.redeploy"),
    }).response;
  }
}

// GET /api/bff/launch/projects — the signed-in user's projects + their apps,
// merged across installations and platforms unless `platform` is explicit.
// Scoped to the github_user_id in the session cookie; a client can never
// request someone else's projects. `projectId` narrows the response to one
// project through the manager's canonical detail read, including the current
// revision-specific ProjectConfiguration.
export async function userProjectsRoute(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;
  const { session, visibilityGrant } = auth;

  try {
    const config = launchConfig();
    const params = new URL(req.url).searchParams;
    const requestedPlatform = params.get("platform");
    const platform =
      requestedPlatform === null
        ? undefined
        : resolveLaunchPlatform(requestedPlatform, config);
    if (requestedPlatform !== null && !platform) {
      return invalidPlatformResponse();
    }
    const requestedProjectId = params.get("projectId");
    const projectId =
      requestedProjectId === null ? undefined : Number(requestedProjectId);
    if (projectId !== undefined && !isValidProjectId(projectId)) {
      return NextResponse.json(
        { error: "invalid `projectId`" },
        { status: 400 },
      );
    }
    // Platform is a list filter only. Once the caller supplies a canonical
    // Project ID, ownership and platform binding come from that Project.
    const listPlatform =
      projectId === undefined ? (platform ?? undefined) : undefined;
    const client = await backendClient();
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
                const project = await timedManagerRead(
                  "get_user_project",
                  () =>
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
                    }
                  : project;
              },
            ),
          ];
    return NextResponse.json({
      projects,
      githubLogin: session.githubLogin,
    });
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "deployment.projects"),
    }).response;
  }
}

// GET /api/bff/deployments/required-secrets?projectId=<n> — the Manager's
// DB-backed secret declarations for each live release plus which required slots
// are still unfilled in the vault. Never returns secret VALUES.
export async function requiredSecretsRoute(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const projectId = Number(new URL(req.url).searchParams.get("projectId"));
  if (!isValidProjectId(projectId)) {
    return NextResponse.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }

  try {
    const client = await backendClient();
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

    return NextResponse.json({ byApp: Object.fromEntries(entries) });
  } catch (err) {
    if (err instanceof BackendError) {
      if (err.status === 404) {
        return NextResponse.json(
          { error: "project not found for this user" },
          { status: 404 },
        );
      }
      return buildFailures.handle({
        source: "launch",
        error: new RequiredSecretsCheckError({
          cause: err,
          reason: "backend_unavailable",
          upstream: "rust",
          upstreamStatus: err.status,
        }),
        context: launchErrorContext(req, "deployment.required_secrets"),
      }).response;
    }
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: launchErrorContext(req, "deployment.required_secrets"),
    }).response;
  }
}
