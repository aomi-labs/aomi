import "@tanstack/react-start/server-only";

import { randomBytes } from "crypto";
import { backendClient } from "@/server/bff/backend";
import { buildFailures } from "@/server/bff/failures";
import { deployConfig } from "@/server/env";
import { resolveDeployPlatform } from "./config";
import { launchAppStatusesResult } from "@aomi-labs/deploy/bff";
import { isValidInstallationId } from "@/lib/validate-input";
import { authorize } from "@/server/bff/auth";
import {
  timedManagerRead,
  deployErrorContext,
  readCache,
  clearDeployReadCache,
  findOwnedProject,
  isValidProjectId,
  invalidPlatformResponse,
} from "./shared";

const CREATED_REPO_PREFIX = "my-playground";

function defaultRepoName() {
  const normalized = CREATED_REPO_PREFIX.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${normalized}-${randomBytes(4).toString("hex")}`;
}

export async function createRepoRoute(req: Request) {
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
      return Response.json(
        { error: "missing or invalid `installationId`" },
        { status: 400 },
      );
    }

    const config = deployConfig();
    const platform = resolveDeployPlatform(body.platform, config);
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
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "launch.create_repo"),
    }).response;
  }
}

export async function projectAppsRoute(req: Request) {
  const auth = await authorize(req);
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
    const client = await backendClient();
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
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "launch.apps"),
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
    const config = deployConfig();
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
      return Response.json({ error: "invalid `projectId`" }, { status: 400 });
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
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "deployment.projects"),
    }).response;
  }
}
