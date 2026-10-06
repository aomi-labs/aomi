/**
 * Pure derivation from a durable RunView (packages/smither readRunView) onto
 * the wire contracts. No I/O — the executing instance, an observer instance,
 * and tests all share this.
 */

import type {
  BuildRunFileNode,
  BuildRunStageStatus,
  BuildRunStatus,
} from "@/features/build/run-contracts";
import { buildFailures } from "@/server/bff/failures";

export type RunViewLike = {
  status: string | null;
  error?: string;
  nodes: Array<{ nodeId: string; state: string; updatedAtMs: number }>;
};

/** Store run status → wire status. Null (unknown run) maps to nothing —
 *  callers keep their live status. */
export function runStatusFromView(
  status: string | null,
): BuildRunStatus | null {
  switch (status) {
    case "finished":
    case "continued":
      return "completed";
    case "failed":
    case "cancelled":
    // Parked-until-quota-resets (smithers 0.28): execution has returned and
    // nothing advances until a later create resumes it (retries preserved),
    // so the wire says failed — the snapshot's error carries the quota detail.
    case "waiting-quota":
      return "failed";
    case "waiting-approval":
    case "waiting-event":
      return status;
    case "running":
    case "waiting-timer":
      return "running";
    default:
      return null;
  }
}

function stageStatusFromNodeState(state: string): BuildRunStageStatus {
  switch (state) {
    case "finished":
    case "skipped":
      return "complete";
    case "failed":
      return "failed";
    case "waiting-approval":
    case "waiting-event":
    case "waiting-timer":
      return "waiting";
    case "running":
    case "retry-wait":
      return "running";
    default:
      return "pending";
  }
}

/**
 * Per-stage statuses from the store, folded onto stage keys and merged over
 * the live event-reducer map. Store rows win (they are the durable truth and
 * cover replayed runs); the live map fills gaps between poll and write.
 */
export function stageStatusesFromView(
  view: RunViewLike,
  foldNode: (nodeId: string) => string,
  live: Record<string, BuildRunStageStatus>,
): Record<string, BuildRunStageStatus> {
  const merged: Record<string, BuildRunStageStatus> = { ...live };
  const RANK: Record<BuildRunStageStatus, number> = {
    pending: 0,
    running: 1,
    waiting: 2,
    failed: 3,
    complete: 4,
  };
  for (const node of view.nodes) {
    const key = foldNode(node.nodeId);
    const next = stageStatusFromNodeState(node.state);
    const prev = merged[key];
    // Within a folded stage (loop bodies), keep the most advanced signal,
    // except a fresh running iteration must not mask an earlier failure...
    // which the store expresses as the loop's own row — so simple rank works.
    if (!prev || RANK[next] >= RANK[prev]) {
      merged[key] = next;
    }
  }
  if (runStatusFromView(view.status) === "completed") {
    // A settled run's unvisited rows (replays, folded loops) are complete.
    for (const key of Object.keys(merged)) {
      if (merged[key] === "running" || merged[key] === "waiting") {
        merged[key] = "complete";
      }
    }
  }
  return merged;
}

/** Typed accessors for the output rows the page renders. */
export function curationFromOutputs(
  outputs: Record<string, ReadonlyArray<Record<string, unknown>>>,
): { summary: string; changedFiles: string; followUps: string } | undefined {
  const row = outputs.curation?.[0];
  if (!row || typeof row.summary !== "string") return undefined;
  return {
    summary: row.summary,
    changedFiles: String(row.changedFiles ?? ""),
    followUps: String(row.followUps ?? ""),
  };
}

export function resultFromOutputs(
  outputs: Record<string, ReadonlyArray<Record<string, unknown>>>,
): { status: string; summary: string } | undefined {
  const row = outputs.result?.[0];
  if (!row || typeof row.summary !== "string") return undefined;
  return { status: String(row.status ?? "complete"), summary: row.summary };
}

/** Crate artifact persisted by the result phase — the Files/Download source
 *  for runs whose filesystem this process cannot see (sandbox runs). */
export function artifactFromOutputs(
  outputs: Record<string, ReadonlyArray<Record<string, unknown>>>,
):
  | { fileTree: BuildRunFileNode[]; crateTarB64: string; warning: string }
  | undefined {
  const row = outputs.result?.[0];
  if (!row) return undefined;
  let fileTree: BuildRunFileNode[] = [];
  if (typeof row.fileTreeJson === "string" && row.fileTreeJson.length > 0) {
    try {
      const parsed = JSON.parse(row.fileTreeJson);
      if (Array.isArray(parsed)) fileTree = parsed as BuildRunFileNode[];
    } catch (error) {
      buildFailures.handle({
        source: "artifact",
        error,
        context: {
          routeFamily: "/api/bff/build/runs",
          operation: "build.artifact_tree_parse",
        },
      });
      // Malformed tree JSON degrades to an empty Files panel, not an error.
    }
  }
  const crateTarB64 =
    typeof row.crateTarB64 === "string" ? row.crateTarB64 : "";
  if (fileTree.length === 0 && crateTarB64.length === 0) return undefined;
  return {
    fileTree,
    crateTarB64,
    warning: String(row.artifactWarning ?? ""),
  };
}
