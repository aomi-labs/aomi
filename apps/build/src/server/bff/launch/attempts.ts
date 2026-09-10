import "server-only";
import { NextResponse } from "next/server";
import { authorize } from "@build/server/bff/auth";
import { backendClient } from "@build/server/bff/backend";
import { buildFailures } from "@build/server/bff/failures";

export async function deploymentAttemptsRoute(req: Request) {
  const write = req.method === "POST";
  const auth = await authorize(req, {
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
    return NextResponse.json(
      { error: "Invalid deployment request" },
      { status: 400 },
    );
  }
  try {
    const client = await backendClient();
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
      return NextResponse.json(
        { error: "Invalid deployment action" },
        { status: 400 },
      );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return buildFailures.handle({
      source: "launch",
      error,
      context: {
        routeFamily: "/api/bff/launch/attempts",
        operation: "launch.attempts",
        method: req.method,
      },
    }).response;
  }
}
