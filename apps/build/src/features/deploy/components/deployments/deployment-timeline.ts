import type { UserProjectLatestDeployment } from "@aomi-labs/deploy";
import type { DeploymentRecord } from "@build/features/launch/contracts";

/** One deployment for the project timeline. `commit` is decoded from the
 * deployment id (`dep_<install>_<repokey>_<shortcommit>`) when history does
 * not carry the full commit hash. */
export type TimelineDeployment = {
  deploymentId: string;
  commit: string | null;
  apps: string[];
  releaseTags: string[];
  current: boolean;
  actor: string | null;
  sdkVersion: string | null;
  createdAt: number;
  /**
   * Build state for this deployment, carried from history so the row can tell
   * whether work is still in flight. Promotion records describe what was
   * *already* promoted and say nothing about CI, so both are null for a
   * deployment known only from records.
   */
  state: string | null;
  ciStatus: string | null;
  ciUrl: string | null;
};

/** One promotion record, tagged with the app it belongs to (for the activity feed). */
export type TimelineActivity = DeploymentRecord & {
  app: string;
};

export function commitFromDeploymentId(deploymentId: string): string | null {
  const parts = deploymentId.split("_");
  return parts.length === 4 ? parts[3] : null;
}

/**
 * Merge deployment history with per-app promotion records into a newest-first
 * deployment list. History is the source of truth for what was deployed;
 * promotion records enrich it with actor and current activation state.
 */
export function buildDeploymentList(
  recordsByApp: Record<string, DeploymentRecord[]> | null,
  history: UserProjectLatestDeployment[] | null = null,
): TimelineDeployment[] {
  const byId = new Map<string, TimelineDeployment>();
  for (const [app, rows] of Object.entries(recordsByApp ?? {})) {
    for (const row of rows) {
      const existing = byId.get(row.deploymentId);
      if (!existing) {
        byId.set(row.deploymentId, {
          deploymentId: row.deploymentId,
          commit: commitFromDeploymentId(row.deploymentId),
          apps: [app],
          releaseTags: [row.releaseTag],
          current: row.current,
          actor: row.actor,
          sdkVersion: row.sdkVersion,
          createdAt: row.createdAt,
          // Promotion records carry no build state. History fills these in
          // below when it knows this deployment.
          state: null,
          ciStatus: null,
          ciUrl: null,
        });
        continue;
      }
      if (!existing.apps.includes(app)) existing.apps.push(app);
      if (!existing.releaseTags.includes(row.releaseTag)) {
        existing.releaseTags.push(row.releaseTag);
      }
      existing.current = existing.current || row.current;
      if (row.createdAt > existing.createdAt) {
        existing.createdAt = row.createdAt;
        existing.actor = row.actor;
        existing.sdkVersion = row.sdkVersion;
      }
    }
  }

  for (const entry of history ?? []) {
    if (!entry.deploymentId) continue;
    const existing = byId.get(entry.deploymentId);
    const apps = entry.apps.map((app) => app.name);
    const releaseTags = [
      ...entry.releaseTags,
      ...entry.apps.flatMap((app) => (app.releaseTag ? [app.releaseTag] : [])),
    ];
    const sdkVersion =
      entry.sdkVersion ??
      entry.apps.find((app) => app.sdkVersion)?.sdkVersion ??
      existing?.sdkVersion ??
      null;
    byId.set(entry.deploymentId, {
      deploymentId: entry.deploymentId,
      commit: existing?.commit ?? commitFromDeploymentId(entry.deploymentId),
      apps: [...new Set([...(existing?.apps ?? []), ...apps])],
      releaseTags: [
        ...new Set([...(existing?.releaseTags ?? []), ...releaseTags]),
      ],
      current: existing?.current ?? false,
      actor: existing?.actor ?? null,
      sdkVersion,
      createdAt: entry.createdAt,
      // History is the only source that knows whether CI is still running.
      state: entry.state ?? null,
      ciStatus: entry.ciStatus ?? null,
      ciUrl: entry.ciUrl ?? null,
    });
  }

  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * CI states that mean work is still in flight for a deployment.
 *
 * `ciStatus` is GitHub's aggregate for the commit (`no_ci | pending | running
 * | passed | failed`); `state` is the backend's deployment projection
 * (`no_ci | building | releasing | ready | failed | pending`). Either can be
 * the one that knows, so both are checked.
 *
 * `pending` means waiting on CI in both vocabularies — never waiting on a
 * person — so it belongs in flight. Promoting during it would dispatch the
 * second run this guard exists to prevent.
 */
const CI_IN_FLIGHT = new Set(["pending", "running"]);
const STATE_IN_FLIGHT = new Set(["pending", "building", "releasing"]);

export function deploymentIsBuilding(deployment: {
  state: string | null;
  ciStatus: string | null;
}): boolean {
  return (
    CI_IN_FLIGHT.has(deployment.ciStatus ?? "") ||
    STATE_IN_FLIGHT.has(deployment.state ?? "")
  );
}

/**
 * Why promotion is unavailable, or null when it is available.
 *
 * Promoting a deployment whose build is still running does not queue politely:
 * it dispatches another CI job that lands behind the first, so the click that
 * was meant to hurry things up makes the wait longer. The window is wide —
 * `busy` only knows about an operation *this* browser tab started, so a
 * reload, a second tab, or a promotion by a teammate all leave the button live
 * unless the deployment's own build state is consulted.
 *
 * Returned as a reason rather than a boolean because a greyed-out button with
 * no explanation is its own bug report.
 */
export function promoteBlockedReason(
  deployment: { state: string | null; ciStatus: string | null },
  options: {
    /** An operation this tab started, for this project, is still running. */
    busy: boolean;
    /** One or more of the deployment's apps is missing a required secret. */
    secretsBlocked: boolean;
  },
): string | null {
  if (options.busy) return "Another deployment operation is still running.";
  if (deploymentIsBuilding(deployment)) {
    return "This deployment is still building. Promoting now would queue a second CI run behind the first.";
  }
  if (options.secretsBlocked) {
    return "Set the required secrets for this deployment's apps first.";
  }
  return null;
}

/** Current first, then newest. Used after runtime remaps `current`. */
export function sortDeploymentsForTimeline(
  deployments: TimelineDeployment[],
): TimelineDeployment[] {
  return [...deployments].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
}

export function buildActivityList(
  recordsByApp: Record<string, DeploymentRecord[]> | null,
): TimelineActivity[] {
  if (!recordsByApp) return [];
  return Object.entries(recordsByApp)
    .flatMap(([app, rows]) => rows.map((row) => ({ ...row, app })))
    .sort((a, b) => b.createdAt - a.createdAt);
}
