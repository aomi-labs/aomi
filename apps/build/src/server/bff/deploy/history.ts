import "@tanstack/react-start/server-only";

import { backendClient } from "@/server/bff/backend";
import { buildFailures } from "@/server/bff/failures";
import { authorize } from "@/server/bff/auth";
import {
  deployErrorContext,
  projectPlatform,
  findOwnedProject,
  isValidProjectId,
} from "./shared";

export async function deploymentHistoryRoute(req: Request) {
  const auth = await authorize(req);
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
    const client = await backendClient();
    const deployments = await client.listUserProjectDeployments({
      githubUserId: session.githubUserId,
      projectId,
      limit: Number.isSafeInteger(limit) && limit > 0 ? limit : undefined,
    });
    return Response.json({ deployments });
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "deployment.history"),
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
    const client = await backendClient();
    const page = await client.listUserDeployments({
      githubUserId: session.githubUserId,
      platform,
      limit,
      cursor,
    });
    return Response.json(page);
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "deployment.feed"),
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
    const client = await backendClient();
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
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "deployment.records"),
    }).response;
  }
}
