import "server-only";

import { NextResponse } from "next/server";
import { backendClient } from "@build/server/bff/backend";
import { clearLaunchReadCache } from "./routes";
import { authorize } from "@build/server/bff/auth";
import { buildFailures } from "@build/server/bff/failures";

export async function projectSdkUpgradeRoute(req: Request) {
  const auth = await authorize(req, { write: true });
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const body: unknown = await req.json().catch(() => null);
  const projectId = Number(
    body && typeof body === "object" && "projectId" in body
      ? body.projectId
      : undefined,
  );
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return NextResponse.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }

  try {
    const client = await backendClient();
    const result = await client.upgradeUserProjectSdk({
      projectId,
      githubUserId: session.githubUserId,
    });
    // The upgrade mutates the project repo; the merged PR changes the
    // project's stamped SDK version, which the cached project list carries.
    clearLaunchReadCache();
    return NextResponse.json(result);
  } catch (error) {
    return buildFailures.handle({
      source: "launch",
      error,
      context: {
        routeFamily: new URL(req.url).pathname,
        operation: "deployment.sdk_upgrade",
        method: req.method,
      },
    }).response;
  }
}

/**
 * Read-only merge poll for the upgrade PR — the cheap counterpart to
 * {@link projectSdkUpgradeRoute}. A GET, so no CSRF/origin gate; the backend
 * answers with a single GitHub call (no repo tarball, no branch mutation),
 * making it safe for the launch flow's 45s recheck loop.
 */
export async function projectSdkUpgradeStatusRoute(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const projectId = Number(
    new URL(req.url).searchParams.get("projectId") ?? undefined,
  );
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return NextResponse.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }

  try {
    const client = await backendClient();
    const result = await client.sdkUpgradeStatus({
      projectId,
      githubUserId: session.githubUserId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return buildFailures.handle({
      source: "launch",
      error,
      context: {
        routeFamily: new URL(req.url).pathname,
        operation: "deployment.sdk_upgrade_status",
        method: req.method,
      },
    }).response;
  }
}
