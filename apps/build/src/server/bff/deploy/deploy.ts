import "@tanstack/react-start/server-only";

import { backendClient } from "@/server/bff/backend";
import { buildFailures } from "@/server/bff/failures";
import { deployConfig } from "@/server/env";
import { resolveDeployPlatform } from "./config";
import { deploymentTargets } from "@aomi-labs/deploy/launch";
import { isValidDeploymentId, isValidRepo } from "@/lib/validate-input";
import { authorize } from "@/server/bff/auth";
import {
  deployErrorContext,
  projectPlatform,
  clearDeployReadCache,
  findOwnedProject,
  isValidProjectId,
  invalidPlatformResponse,
} from "./shared";

function sourceRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(clean) ? clean : null;
}

export function deployRoute(preflight: boolean) {
  return async function POST(req: Request): Promise<Response> {
    const auth = await authorize(req, { write: true, cliScope: "deploy" });
    if ("response" in auth) return auth.response;
    const { session } = auth;

    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (body.projectId !== undefined && !isValidProjectId(body.projectId)) {
      return Response.json({ error: "invalid `projectId`" }, { status: 400 });
    }
    if (body.repo !== undefined && !isValidRepo(body.repo)) {
      return Response.json({ error: "invalid `repo`" }, { status: 400 });
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
      return buildFailures.handle({
        source: "launch",
        error: err,
        context: deployErrorContext(
          req,
          preflight ? "launch.preflight" : "launch.deploy",
        ),
      }).response;
    }
  };
}

export async function deploymentStatusRoute(req: Request) {
  const auth = await authorize(req, { cliScope: "deployment:read" });
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
    const config = deployConfig();
    const platform = resolveDeployPlatform(
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
    return Response.json({
      ...result,
      releaseTags: deploymentTargets(result.deployment).map(
        (target) => target.releaseTag,
      ),
    });
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "launch.status"),
    }).response;
  }
}

export async function redeployRoute(req: Request) {
  const auth = await authorize(req, { write: true });
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
    const config = deployConfig();
    const client = await backendClient();
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
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "deployment.redeploy"),
    }).response;
  }
}
