import "@tanstack/react-start/server-only";

import type { OperateObservabilitySnapshot } from "@aomi-labs/deploy";
import { buildFailures } from "@/server/bff/failures";
import {
  identifyOperateFailure,
  isValidProjectId,
  readCache,
  platformProjectIds,
  onPlatform,
  operateSession,
  batchScope,
} from "./scope";

export async function operateObservabilityRoute(req: Request) {
  try {
    const requestedPlatform =
      new URL(req.url).searchParams.get("platform") ?? undefined;
    const scope = await batchScope(req);
    if ("response" in scope) return scope.response;
    const { projectId } = scope;
    // Kick the platform's source list off first so it overlaps the snapshot
    // below rather than following it.
    const sourcesPending = scope.platformProjects();

    // One manager request for the whole account. Without an explicit
    // `platform` filter the manager resolves each source under its own
    // bound/loaded platform, which also covers partner-bound projects that the
    // per-source read rejects as not launch-relevant on the default platform.
    // The platform scope is then applied here, so this page shows exactly the
    // projects `/projects` lists rather than every platform the account owns.
    const [results, projects] = await Promise.all([
      readCache.observabilityBatch.get(
        [scope.githubUserId, requestedPlatform ?? null, projectId ?? null],
        () =>
          scope.client.getUserObservability({
            githubUserId: scope.githubUserId,
            projectId,
          }),
      ) as Promise<OperateObservabilitySnapshot[]>,
      sourcesPending,
    ]);
    const scoped = onPlatform(results, platformProjectIds(projects));
    const apps = scoped.flatMap((result) =>
      result.apps.map((app) => ({
        ...app,
        project: result.project,
        platform: result.platform,
      })),
    );
    return Response.json({
      // Every source on this platform, not just the ones this read covered:
      // the filter dropdown is how a user loads one source on its own.
      projects,
      scope: "owned_applications",
      monitoring: {
        provider: "grafana_prometheus",
        status: scoped.some((result) => result.monitoring?.status === "ok")
          ? scoped.some((result) => result.monitoring?.status !== "ok")
            ? "partial"
            : "ok"
          : (scoped[0]?.monitoring?.status ?? "unconfigured"),
        windowSeconds: scoped[0]?.monitoring?.windowSeconds ?? 0,
      },
      apps,
      dashboardLinks: scoped.flatMap((result) => result.dashboardLinks),
      platformMetrics: scoped[0]?.platformMetrics ?? [],
    });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.observability", err),
    ).response;
  }
}

export async function operateAppDetailRoute(req: Request) {
  const params = new URL(req.url).searchParams;
  const applicationId = Number(params.get("applicationId"));
  if (!isValidProjectId(applicationId)) {
    return Response.json(
      { error: "missing or invalid `applicationId`" },
      { status: 400 },
    );
  }

  try {
    const session = await operateSession(req);
    if ("response" in session) return session.response;
    const detail = await readCache.appDetail.get(
      [session.githubUserId, applicationId],
      () =>
        session.client.getBuilderApplicationDetail({
          githubUserId: session.githubUserId,
          applicationId,
        }),
    );
    const projectId = detail.project.id;
    const input = {
      githubUserId: session.githubUserId,
      projectId,
    };
    const [observability, transactionsResult, logsResult, deployments] =
      await Promise.all([
        readCache.observability.get(
          [session.githubUserId, detail.platform, projectId],
          () => session.client.getUserProjectObservability(input),
        ),
        readCache.transactions.get(
          [session.githubUserId, detail.platform, projectId, { limit: 100 }],
          () =>
            session.client.listUserProjectTransactions({
              ...input,
              limit: 100,
            }),
        ),
        readCache.logs.get(
          [session.githubUserId, detail.platform, projectId, { limit: 200 }],
          () => session.client.listUserProjectLogs({ ...input, limit: 200 }),
        ),
        readCache.deployments.get(
          [session.githubUserId, detail.platform, projectId, { limit: 20 }],
          () =>
            session.client.listUserProjectDeployments({ ...input, limit: 20 }),
        ),
      ]);

    return Response.json({
      detail,
      health:
        observability.apps.find((app) => app.applicationId === applicationId) ??
        null,
      transactions: transactionsResult.transactions
        .filter((row) => row.applicationId === applicationId)
        .slice(0, 4),
      logs: logsResult.logs
        .filter((row) => row.applicationId === applicationId)
        .slice(0, 4),
      deployments,
    });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.app_detail", err),
    ).response;
  }
}
