/**
 * Build's launch and deployments families over the manager client: one
 * endpoint per route, each one ownership check and one or two manager calls.
 * The manager is the authority on everything past input shape; its failures
 * reach the UI through `failureResponse`.
 */
import { BackendError, builderSecretSlots, missingRequiredSecrets } from "@aomi-labs/deploy";
import { deploymentTargets } from "@aomi-labs/deploy/launch";
import {
  launchAppStatusesResult,
  missingSecretsForActivation,
  RequiredSecretsCheckError,
  type ManagerClient,
} from "@aomi-labs/internal";
import { z } from "zod";

import { randomHex } from "../kernel/crypto";
import { EdgeError } from "../kernel/errors";
import { id, names, numeric, text } from "../kernel/route";
import { endpoint, notFound, type BuildRoute, type Call, type Handler } from "./endpoint";
import { buildError } from "./failures";
import { managerClient, sdkBackendUrl } from "./manager-client";
import { platformSlug } from "./endpoint";

type Project = Awaited<ReturnType<ManagerClient["listUserProjects"]>>[number];
type ReleasePair = { app: string; releaseTag: string };

const launch = (name: string) => `/api/build/launch/${name}`;
const deployments = (name: string) => `/api/build/deployments/${name}`;

const byProject = z.object({ projectId: id });
const byApplication = z.object({ applicationId: id });
const someNames = names.pipe(z.array(z.string()).min(1));
const sourceRef = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{7,40}$/)
  .optional()
  .catch(undefined);

/** The caller's project with `projectId`. The account-wide list is the
 *  ownership source, so a partner-bound project is never invisible. */
async function owned(
  { client, session }: Call<unknown>,
  projectId: number,
  missing = "project not found for this user",
): Promise<Project> {
  const projects = await client.listUserProjects({ githubUserId: session.githubUserId });
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) throw notFound(missing);
  return project;
}

/** The platform a known project's platform-addressed calls must use. */
function boundPlatform(project: Project): string {
  const bound = project.platformName.trim();
  if (!bound) throw new Error("project is missing its bound platform");
  return bound;
}

/** 409 unless every app/release pair has its required secrets filled. */
async function requireSecrets(call: Call<unknown>, project: Project, pairs: ReleasePair[]): Promise<void> {
  const missing = await missingSecretsForActivation({
    client: call.client,
    githubUserId: call.session.githubUserId,
    project,
    pairs,
    githubToken: call.ctx.env.BUILD_GITHUB_TOKEN,
  });
  if (Object.keys(missing).length) throw new EdgeError(409, "missing required secrets", { body: { missing } });
}

function deploy(preflight: boolean) {
  return endpoint(preflight ? "launch.preflight" : "launch.deploy", "POST", "", {
    auth: { write: true, cliScope: "deploy" },
    input: z.object({
      projectId: id.optional(),
      repo: z.string().trim().regex(/^[^/]+\/[^/]+$/).optional(),
      sourceRef,
    }),
    status: preflight ? 200 : 202,
    run: async (call) => {
      const { input, client, session, request } = call;
      // Preflight may resolve an existing Project by repository; creation is
      // an explicit lifecycle. Deploy reuses preflight's Project and commit.
      let projectId: number;
      if (input.projectId !== undefined) projectId = (await owned(call, input.projectId)).id;
      else if (preflight && input.repo) {
        const repo = input.repo.toLowerCase();
        const projects = await client.listUserProjects({ githubUserId: session.githubUserId });
        const project = projects.find((candidate) => candidate.repositoryLink.trim().toLowerCase() === repo);
        if (!project)
          throw notFound("repository is not connected as a Project; run `aomi-build project create` first");
        projectId = project.id;
      } else throw new EdgeError(400, preflight ? "missing `projectId` or `repo`" : "missing `projectId`");
      if (!preflight && !input.sourceRef) throw new EdgeError(400, "missing source commit from preflight");

      const actor = session.githubLogin;
      const { deployment } = preflight
        ? await client.preflight({ projectId, sourceRef: input.sourceRef, actor })
        : await client.deploy({ projectId, sourceRef: input.sourceRef!, actor });
      const projectUrl = new URL(`/projects/${projectId}`, request.url);
      projectUrl.searchParams.set("tab", "deployments");
      const targets = deploymentTargets(deployment);
      return {
        ok: true,
        repo: deployment.source.repositoryLink ?? input.repo,
        installationId: deployment.source.installationId ? String(deployment.source.installationId) : undefined,
        projectId,
        sourceRef: deployment.source.commitHash,
        deployment,
        releaseTags: targets.map((target) => target.releaseTag),
        apps: targets.map((target) => target.name),
        projectUrl: projectUrl.toString(),
      };
    },
  });
}

const createRepo = endpoint("launch.create_repo", "POST", launch("create"), {
  auth: { write: true },
  input: z.object({
    platform: platformSlug.optional(),
    installationId: z.string().trim().regex(/^\d+$/),
    repoName: z.string().trim().optional(),
  }),
  run: async ({ input, client, session, ctx }) => {
    const { config } = ctx;
    const project = await client.scaffold({
      platform: input.platform ?? config.defaultPlatform,
      installationId: Number(input.installationId),
      templateRepo: config.templateRepo,
      repoName: input.repoName || `my-playground-${randomHex(4)}`,
      githubUserId: session.githubUserId,
      private: config.createdRepoPrivate,
    });
    if (!project.repositoryLink || !project.installationId)
      throw new EdgeError(502, "backend did not return a created project");
    return {
      ok: true,
      repo: project.repositoryLink,
      installationId: String(project.installationId),
      projectId: project.id,
      project,
    };
  },
});

const status = endpoint("launch.status", "GET", "", {
  auth: { cliScope: "deployment:read" },
  input: z.object({ deploymentId: text, platform: platformSlug.optional() }),
  run: async ({ input, client, session, ctx }) => {
    // The backend resolves CI live per poll and deep-links the run URL.
    const result = await client.status({
      platform: input.platform ?? ctx.config.defaultPlatform,
      deploymentId: input.deploymentId,
      githubUserId: session.githubUserId,
    });
    return { ...result, releaseTags: deploymentTargets(result.deployment).map((target) => target.releaseTag) };
  },
});

const activate = endpoint("launch.activate", "POST", launch("activate"), {
  auth: { write: true, cliScope: "activate" },
  input: z
    .object({ releaseTags: z.array(text), projectId: id, apps: names })
    .refine(
      ({ apps, releaseTags }) => apps.length > 0 && apps.length === releaseTags.length,
      "`apps` must match `releaseTags` length",
    ),
  run: async (call) => {
    const { input, client, session } = call;
    const project = await owned(call, input.projectId);
    await requireSecrets(
      call,
      project,
      input.apps.map((app, index) => ({ app, releaseTag: input.releaseTags[index] })),
    );
    return client.activateUserProjectReleases({
      githubUserId: session.githubUserId,
      projectId: project.id,
      releaseTags: input.releaseTags,
      apps: input.apps,
      actor: session.githubLogin,
    });
  },
});

const projectApps = endpoint("launch.apps", "GET", launch("apps"), {
  input: byProject,
  run: async (call) => {
    const project = await owned(call, call.input.projectId);
    const { apps } = await call.client.listUserProjectApps({
      githubUserId: call.session.githubUserId,
      projectId: project.id,
    });
    return launchAppStatusesResult(project.id, apps);
  },
});

/** Public: the SDK version the backend requires, and the CLI's repair hint. */
const sdkStatus: Handler = async (request, ctx) => {
  const { serverTags, sdkVersion } = await (await managerClient(request, ctx)).serverTags();
  return Response.json({
    ok: true,
    serverTags,
    sdkStatus: {
      requiredVersion: sdkVersion,
      status: sdkVersion ? "unknown" : "missing",
      fixCommand: sdkVersion ? `aomi-build sdk fix --backend ${sdkBackendUrl(ctx)}` : null,
    },
  });
};

const history = endpoint("deployment.history", "GET", deployments("history"), {
  input: z.object({ projectId: id, limit: id.catch(20) }),
  run: async ({ input, client, session }) => ({
    deployments: await client.listUserProjectDeployments({ githubUserId: session.githubUserId, ...input }),
  }),
});

const integer = numeric(z.number().int());

const feed = endpoint("deployment.feed", "GET", deployments("feed"), {
  input: z
    .object({
      platform: z.string().trim().optional(),
      limit: numeric(z.number().int().positive().max(100)).default(50),
      cursorCreatedAt: integer.optional(),
      cursorId: integer.optional(),
    })
    .refine(
      ({ cursorCreatedAt, cursorId }) => (cursorCreatedAt === undefined) === (cursorId === undefined),
      "invalid deployment feed cursor",
    ),
  run: async ({ input, client, session }) =>
    client.listUserDeployments({
      githubUserId: session.githubUserId,
      platform: input.platform || undefined,
      limit: input.limit,
      cursor:
        input.cursorCreatedAt === undefined || input.cursorId === undefined
          ? null
          : { createdAt: input.cursorCreatedAt, id: input.cursorId },
    }),
});

/** The caller's application, proven through the manager's builder read. */
async function ownedApplication({ client, session }: Call<unknown>, applicationId: number) {
  const { application } = await client.getBuilderApplication({ githubUserId: session.githubUserId, applicationId });
  return application;
}

const secrets = endpoint("deployment.secrets_read", "GET", deployments("secrets"), {
  input: byApplication,
  run: async (call) => {
    const application = await ownedApplication(call, call.input.applicationId);
    const { byApp } = await call.client.listAppSecrets({ applicationId: call.input.applicationId });
    return { byApp: { [application.name]: byApp[application.name] ?? [] } };
  },
});

const secretsWrite = endpoint("deployment.secrets_write", "POST", deployments("secrets"), {
  auth: { write: true },
  input: z.object({
    applicationId: id,
    // A { KEY: value } map; blank keys and empty or non-string values drop out.
    secrets: z
      .record(z.string(), z.unknown())
      .catch({})
      .transform((map) =>
        Object.fromEntries(
          Object.entries(map).flatMap(([key, value]) =>
            key.trim() && typeof value === "string" && value ? [[key.trim(), value]] : [],
          ),
        ),
      )
      .refine((map) => Object.keys(map).length > 0, "no valid secrets provided"),
  }),
  status: 202,
  run: async (call) => {
    const { applicationId, secrets } = call.input;
    const application = await ownedApplication(call, applicationId);
    const { handles } = await call.client.ingestSecrets({ applicationId, app: application.name, secrets });
    return { ok: true, keys: Object.keys(handles) };
  },
});

const secretsDelete = endpoint("deployment.secrets_delete", "DELETE", deployments("secrets"), {
  auth: { write: true },
  input: z.object({ name: text, applicationId: id }),
  run: async (call) => {
    await ownedApplication(call, call.input.applicationId);
    return { ok: true, removed: await call.client.removeAppSecret(call.input) };
  },
});

const records = endpoint("deployment.records", "GET", deployments("records"), {
  input: z.object({ app: text, projectId: id }),
  run: async (call) => {
    const { app, projectId } = call.input;
    const project = await owned(call, projectId, "app not found for this user");
    if (!project.apps.some((candidate) => candidate.name === app)) throw notFound("app not found for this user");
    return call.client.listDeploymentRecords({ platform: boundPlatform(project), app, projectId });
  },
});

const promote = endpoint("deployment.promote", "POST", deployments("promote"), {
  auth: { write: true },
  input: z.object({ deploymentId: text, projectId: id, apps: names.optional().catch(undefined) }),
  status: 202,
  run: async (call) => {
    const { input, client, session } = call;
    const { projectId, deploymentId } = input;
    // Authorize at the Project boundary; the exact deployment projection
    // then proves the candidate and supplies the release pairs (promotion
    // history is empty before the first promote, so it never can).
    const project = await owned(call, projectId);
    const deployment = await client.getUserProjectDeployment({
      githubUserId: session.githubUserId,
      projectId,
      deploymentId,
    });
    if (!deployment) throw notFound("deployment does not belong to this project");
    const apps = input.apps ?? deployment.apps.map((app) => app.name);
    const pairs = deployment.apps.flatMap((app) =>
      apps.includes(app.name) && app.releaseTag ? [{ app: app.name, releaseTag: app.releaseTag }] : [],
    );
    if (pairs.length !== apps.length) throw notFound("deployment does not contain all requested apps");
    await requireSecrets(call, project, pairs);
    const result = await client.promoteUserProjectDeployment({
      githubUserId: session.githubUserId,
      projectId,
      deploymentId,
      mode: "targeted",
      apps,
      actor: session.githubLogin,
    });
    return result.ok ? result : Response.json(result, { status: 409 });
  },
});

const deactivate = endpoint("deployment.deactivate", "POST", deployments("deactivate"), {
  auth: { write: true },
  input: z.object({ projectId: id, apps: someNames }),
  status: 202,
  run: async (call) => {
    const { apps } = call.input;
    const project = await owned(call, call.input.projectId);
    const applications = project.apps.filter((candidate) => apps.includes(candidate.name));
    if (applications.length !== apps.length) throw notFound("application not found in project");
    const platform = boundPlatform(project);
    for (const application of applications)
      await call.client.deactivateApplication({
        platform,
        applicationId: application.id,
        app: application.name,
        actor: call.session.githubLogin,
      });
    return { ok: true, apps };
  },
});

const redeploy = endpoint("deployment.redeploy", "POST", deployments("redeploy"), {
  auth: { write: true },
  input: byProject,
  run: async (call) => {
    const { client, session } = call;
    const { projectId } = call.input;
    const project = await owned(call, projectId);
    const latest = await client.getUserProjectLatestDeployment({ githubUserId: session.githubUserId, projectId });
    if (!latest?.deploymentId)
      throw new EdgeError(
        409,
        "No backend-owned deployment is available for this project yet; refusing to reuse Deploy because GitHub can skip tree-identical pushes.",
      );
    // The backend re-runs the Actions run behind the recorded commit.
    const rerun = await client.rerunDeployment({
      platform: boundPlatform(project),
      deploymentId: latest.deploymentId,
      githubUserId: session.githubUserId,
    });
    return {
      ok: rerun.ok,
      projectId,
      platformRepo: latest.platformRepo ?? null,
      ciRunId: rerun.runId === null ? null : String(rerun.runId),
      ciUrl: rerun.ciUrl ?? latest.ciUrl ?? null,
    };
  },
});

/** The live SDK summary the manager stamps on its list read but not its detail read. */
const SDK_SUMMARY = [
  "sdkVersion",
  "sdkVersions",
  "ffiVersion",
  "ffiVersions",
  "requiredFfiVersion",
  "ffiUnrecorded",
  "ffiIncompatible",
  "ffiUnverifiedSdkVersions",
] as const;

// The signed-in user's projects (a `platform` narrows the list), or with
// `projectId` that one project through the manager's detail read.
const userProjects = endpoint("deployment.projects", "GET", "", {
  input: z.object({ platform: platformSlug.optional(), projectId: id.optional() }),
  run: async ({ input, client, session, visibilityGrant }) => {
    const scope = { githubUserId: session.githubUserId, visibilityGrant: visibilityGrant ?? undefined };
    if (input.projectId === undefined)
      return {
        projects: await client.listUserProjects({ ...scope, platform: input.platform }),
        githubLogin: session.githubLogin,
      };
    const projectId = input.projectId;
    const project = await client.getUserProject({ ...scope, projectId });
    // Only live apps carry a runtime SDK; fill a missing stamp from the list
    // so the project page and the Projects index agree.
    const stamped = project.sdkVersion != null || (project.sdkVersions?.length ?? 0) > 0;
    const live = project.apps.some((app) => app.isActive && app.appReleaseTag != null);
    const listed =
      stamped || !live ? undefined : (await client.listUserProjects(scope)).find((row) => row.id === projectId);
    const summary = listed ? Object.fromEntries(SDK_SUMMARY.map((key) => [key, listed[key]])) : {};
    return { projects: [{ ...project, ...summary }], githubLogin: session.githubLogin };
  },
});

// The manager's secret declarations for each live release plus the required
// slots still unfilled in the vault. Never secret values.
const requiredSecrets = endpoint("deployment.required_secrets", "GET", deployments("required-secrets"), {
  input: byProject,
  run: async ({ input, client, session }) => {
    try {
      const declared = await client.getUserProjectRequiredSecrets({ githubUserId: session.githubUserId, ...input });
      const entries = await Promise.all(
        Object.entries(declared.byApp).map(async ([app, { applicationId, slots }]) => {
          const configured = await client.listAppSecrets({ applicationId });
          const keys = (configured.byApp[app] ?? []).map((handle) => handle.split("::").pop() ?? handle);
          const missing = missingRequiredSecrets(slots, keys).map((slot) => slot.name);
          return [app, { applicationId, slots: builderSecretSlots(slots), missing }] as const;
        }),
      );
      return { byApp: Object.fromEntries(entries) };
    } catch (error) {
      if (!(error instanceof BackendError)) throw error;
      if (error.status === 404) throw notFound("project not found for this user");
      throw new RequiredSecretsCheckError({
        cause: error,
        reason: "backend_unavailable",
        upstream: "rust",
        upstreamStatus: error.status,
      });
    }
  },
});

// The key a builder shares so others can use a private application in Chat:
// GET shows it, POST issues a new one and revokes the old.
function appKey(method: "GET" | "POST") {
  return endpoint("deployment.app_key", method, deployments("app-key"), {
    auth: { write: method === "POST" },
    input: byApplication,
    run: async ({ input, client, session }) => {
      const scope = { githubUserId: session.githubUserId, applicationId: input.applicationId, actor: session.githubLogin };
      try {
        return {
          appKey: await (method === "POST" ? client.regenerateBuilderAppKey(scope) : client.getBuilderAppKey(scope)),
        };
      } catch (error) {
        if (error instanceof BackendError && error.status === 404) throw notFound("application not found for this user");
        throw error;
      }
    },
  });
}

const attemptsRead = endpoint("launch.attempts", "GET", launch("attempts"), {
  auth: { cliScope: "deployment:read" },
  input: z.object({
    projectId: id,
    runId: id.optional(),
    page: numeric(z.number().int().min(1).max(10_000)).optional(),
  }),
  run: ({ input, client, session }) =>
    client.projectDeploymentAttempts({ ...input, githubUserId: session.githubUserId }),
});

const attemptsWrite = endpoint("launch.attempts", "POST", launch("attempts"), {
  auth: { write: true, cliScope: "deploy" },
  input: z.discriminatedUnion("action", [
    z.object({ action: z.literal("start"), projectId: id, branch: z.string().max(120).optional() }),
    z.object({ action: z.literal("cancel"), projectId: id, runId: id }),
  ]),
  run: ({ input, client, session }): Promise<unknown> => {
    const { action, ...scope } = input;
    const githubUserId = session.githubUserId;
    return "runId" in scope
      ? client.cancelProjectDeploymentAttempt({ ...scope, githubUserId })
      : client.startProjectDeploymentAttempt({ ...scope, githubUserId });
  },
});

// Builder-owned source repository access. Permission state changes out of
// band (an org owner accepting on GitHub), which is why it is never cached.
const githubAppInstallations = endpoint("deployment.github_app_installations", "GET", deployments("github-app"), {
  run: ({ client, session }) =>
    client.listUserGitHubAppInstallations({ githubUserId: session.githubUserId }).catch((error: unknown) => {
      throw new EdgeError(buildError(error).status, "Couldn’t check GitHub repository access. Try again.", {
        cause: error,
      });
    }),
});

const sdkUpgrade = endpoint("deployment.sdk_upgrade", "POST", deployments("sdk-upgrade"), {
  auth: { write: true },
  input: byProject,
  run: ({ input, client, session }) => client.upgradeUserProjectSdk({ ...input, githubUserId: session.githubUserId }),
});

// The cheap merge poll for the upgrade PR: one GitHub call on the backend,
// safe for the launch flow's recheck loop.
const sdkUpgradeStatus = endpoint("deployment.sdk_upgrade_status", "GET", deployments("sdk-upgrade-status"), {
  input: byProject,
  run: ({ input, client, session }) => client.sdkUpgradeStatus({ ...input, githubUserId: session.githubUserId }),
});

/** A route served at both its launch and its deployments path. */
function both(route: BuildRoute, name: string): BuildRoute[] {
  return [
    { ...route, path: launch(name) },
    { ...route, path: deployments(name), operation: route.operation.replace(/^launch\./, "deployment.") },
  ];
}

export const DEPLOY_ROUTES: readonly BuildRoute[] = [
  ...both(deploy(false), "deploy"),
  ...both(deploy(true), "preflight"),
  ...both(userProjects, "projects"),
  ...both(redeploy, "redeploy"),
  ...both(status, "status"),
  ...both({ operation: "launch.sdk_status", method: "GET", path: "", handle: sdkStatus }, "sdk-status"),
  createRepo,
  activate,
  projectApps,
  attemptsRead,
  attemptsWrite,
  appKey("GET"),
  appKey("POST"),
  deactivate,
  feed,
  githubAppInstallations,
  history,
  promote,
  records,
  requiredSecrets,
  sdkUpgrade,
  sdkUpgradeStatus,
  secrets,
  secretsWrite,
  secretsDelete,
];
