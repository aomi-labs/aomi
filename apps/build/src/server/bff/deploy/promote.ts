import "@tanstack/react-start/server-only";

import { backendClient } from "@/server/bff/backend";
import { buildFailures } from "@/server/bff/failures";
import { deployConfig } from "@/server/env";
import { missingSecretsForActivation } from "@aomi-labs/deploy/bff";
import { isValidDeploymentId, isValidReleaseTags } from "@/lib/validate-input";
import { authorize } from "@/server/bff/auth";
import {
  deployErrorContext,
  projectPlatform,
  clearDeployReadCache,
  findOwnedProject,
  isValidProjectId,
} from "./shared";

export async function activateRoute(req: Request) {
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

    const client = await backendClient();
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
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "launch.activate"),
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
    const client = await backendClient();

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
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "deployment.promote"),
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
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "deployment.deactivate"),
    }).response;
  }
}
