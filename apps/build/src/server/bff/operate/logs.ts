import "@tanstack/react-start/server-only";

import type {
  OperateLogCursor,
  OperateLogsResult,
  UserProject,
} from "@aomi-labs/deploy";
import { buildFailures } from "@/server/bff/failures";
import {
  identifyOperateFailure,
  readCache,
  platformProjectIds,
  onPlatform,
  ownedSources,
  batchScope,
} from "./scope";
import {
  settleBySource,
  nothingRead,
  operateUnavailableResponse,
} from "./fanout";
import {
  pageLimit,
  parseCompositeCursor,
  sourceCursor,
  mergedNextCursor,
} from "./cursor";

function logCursorFor(row: {
  occurredAt: number;
  eventType: string;
  id: string;
}): OperateLogCursor {
  return {
    occurredAt: row.occurredAt,
    eventType: row.eventType,
    id: row.id,
  };
}

export async function operateLogsRoute(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const limit = pageLimit(params, 100, 200);
    const cursor = parseCompositeCursor(params.get("cursor"));
    const type = params.get("type") ?? undefined;
    const requestedPlatform = params.get("platform") ?? undefined;

    // Account-wide reads go through the manager's batch endpoint: the merged
    // stream arrives already interleaved, deduplicated (a shared partner
    // settlement is one table row) and paginated by one global cursor, so
    // none of the per-source merge/dedupe below applies. A single-source view
    // stays on the per-source read.
    if (!params.has("projectId")) {
      const scope = await batchScope(req);
      if ("response" in scope) return scope.response;
      const sourcesPending = scope.platformProjects();
      const [batch, projects] = await Promise.all([
        readCache.logsBatch.get(
          [
            scope.githubUserId,
            requestedPlatform ?? null,
            { limit, type, cursor: cursor?.batch ?? null },
          ],
          () =>
            scope.client.listUserLogs({
              githubUserId: scope.githubUserId,
              limit,
              type,
              cursor: (cursor?.batch ?? undefined) as
                | OperateLogCursor
                | undefined,
            }),
        ),
        sourcesPending,
      ]);
      const sourceById = new Map(
        batch.projects.map((ref) => [ref.project.id, ref.project]),
      );
      return Response.json({
        projects,
        // The merged stream covers every platform the account owns; narrow it
        // to the selected one. Account-level rows (a shared partner
        // settlement carries no projectId) stay.
        logs: onPlatform(
          batch.logs.map(({ projectId, platform, ...log }) => ({
            ...log,
            project:
              (projectId != null ? sourceById.get(projectId) : undefined) ??
              null,
            platform: platform ?? scope.platform,
          })),
          platformProjectIds(projects),
        ),
        nextCursor: batch.nextCursor ? { batch: batch.nextCursor } : null,
      });
    }

    const owned = await ownedSources(req);
    if ("response" in owned) return owned.response;
    const logReads = await settleBySource<OperateLogsResult>(
      owned.projects,
      "operate.logs_source",
      (source) =>
        readCache.logs.get(
          [
            owned.githubUserId,
            owned.platform,
            source.id,
            { limit, type, cursor: sourceCursor(cursor, source.id) },
          ],
          () =>
            owned.client.listUserProjectLogs({
              githubUserId: owned.githubUserId,
              projectId: source.id,
              limit,
              type,
              cursor: sourceCursor(cursor, source.id) as
                | OperateLogCursor
                | string
                | undefined,
            }),
        ),
    );
    if (nothingRead(owned.projects, logReads)) {
      return operateUnavailableResponse();
    }
    const results = logReads.ok;
    const sourcedLogs = results.flatMap((result) =>
      result.logs.map((entry) => ({
        ...entry,
        project: result.project,
        platform: result.platform,
      })),
    );
    const logById = new Map<
      string,
      (typeof sourcedLogs)[number] & { cursorSources: UserProject[] }
    >();
    for (const log of sourcedLogs) {
      const sharedSettlement = log.details.source === "partner_settlement";
      const key = sharedSettlement
        ? `partner-settlement:${log.id}`
        : `${log.project.id}:${log.eventType}:${log.id}`;
      const existing = logById.get(key);
      if (existing) {
        existing.cursorSources.push(log.project as UserProject);
      } else {
        logById.set(key, {
          ...log,
          cursorSources: [log.project as UserProject],
        });
      }
    }
    const logs = [...logById.values()].sort(
      (a, b) =>
        b.occurredAt - a.occurredAt ||
        b.eventType.localeCompare(a.eventType) ||
        b.id.localeCompare(a.id),
    );
    const visible = logs.slice(0, limit);
    const cursorRows = visible.flatMap((log) =>
      log.cursorSources.map((project) => ({ ...log, project })),
    );
    return Response.json({
      // Every source the account owns, not just the ones this read covered:
      // the filter dropdown is how a user retries a dropped source on its own.
      projects: owned.projects,
      logs: visible.map(({ cursorSources: _cursorSources, ...log }) => log),
      nextCursor: mergedNextCursor(
        cursor,
        cursorRows,
        sourcedLogs,
        results,
        logCursorFor,
      ),
    });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.logs", err),
    ).response;
  }
}
