/**
 * Pure mapping from a BFF BuildRunSnapshot (real aomi-smither run) onto the
 * /build page's view contracts. Product labels only — engine names never
 * reach the UI (see SmithersNode docs in contracts.ts).
 */

import type {
  BuildStreamEvent,
  BuildStreamStage,
  SmithersNode,
  PlanNodeStatus,
} from "@/features/build/contracts";
import type {
  BuildRunSnapshot,
  BuildRunStage,
  BuildRunStageStatus,
} from "@/features/build/run-contracts";

function nodeStatus(status: BuildRunStageStatus): PlanNodeStatus {
  switch (status) {
    case "complete":
      return "done";
    case "running":
    case "waiting":
    case "failed":
      return "active";
    case "pending":
      return "pending";
  }
}

/** Product-facing role chip for a plan stage. */
function roleFor(stage: BuildRunStage): string {
  const phase = stage.id.split(":").pop() ?? stage.id;
  if (phase.startsWith("binaries")) return "Setup";
  if (phase.startsWith("codegen") || phase.startsWith("draft-spec")) {
    return "Generator";
  }
  if (
    phase.startsWith("validate") ||
    phase.startsWith("smoke") ||
    stage.kind === "eval"
  ) {
    return "Tester";
  }
  if (phase.startsWith("deploy") || phase.startsWith("result")) return "Shipper";
  if (stage.kind === "agent") return "Reviewer";
  if (stage.kind === "clarify" || stage.kind === "approval") return "Decision";
  return "Planner";
}

export function nodesFromSnapshot(snapshot: BuildRunSnapshot): SmithersNode[] {
  return snapshot.stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    role: roleFor(stage),
    detail:
      stage.status === "failed"
        ? "Failed — see activity log"
        : stage.status === "waiting"
          ? "Waiting on a decision"
          : "",
    status: nodeStatus(stage.status),
  }));
}

/** Which stream-timeline lane each plan stage reports into. */
function laneFor(stage: BuildRunStage): BuildStreamStage {
  const phase = stage.id.split(":").pop() ?? stage.id;
  if (phase.startsWith("binaries")) return "plan";
  if (
    phase.startsWith("validate") ||
    phase.startsWith("smoke") ||
    stage.kind === "eval"
  ) {
    return "validate";
  }
  if (phase.startsWith("deploy") || phase.startsWith("result")) return "ready";
  return "generate";
}

const LANE_MESSAGES: Record<BuildStreamStage, string> = {
  plan: "Preparing toolchain and build plan.",
  generate: "Generating project files and tool wiring.",
  validate: "Compiling and testing the generated app.",
  ready: "Finalizing — ship when green.",
};

const LANES: BuildStreamStage[] = ["plan", "generate", "validate", "ready"];

function laneStatus(
  statuses: BuildRunStageStatus[],
): BuildStreamEvent["status"] {
  if (statuses.length === 0) return "pending";
  if (statuses.every((s) => s === "complete")) return "done";
  if (statuses.some((s) => s !== "pending")) return "active";
  return "pending";
}

export function streamEventsFromSnapshot(
  snapshot: BuildRunSnapshot,
): BuildStreamEvent[] {
  const byLane = new Map<BuildStreamStage, BuildRunStageStatus[]>();
  const laneTimes = new Map<BuildStreamStage, string>();
  for (const stage of snapshot.stages) {
    // Parallel header rows aggregate their branches; count leaves only.
    if (stage.kind === "parallel") continue;
    const lane = laneFor(stage);
    byLane.set(lane, [...(byLane.get(lane) ?? []), stage.status]);
    // Stage rows arrive in composition order; keep the latest transition.
    if (stage.time) laneTimes.set(lane, stage.time);
  }
  return LANES.map((lane) => ({
    time: laneTimes.get(lane) ?? "",
    stage: lane,
    message: LANE_MESSAGES[lane],
    status: laneStatus(byLane.get(lane) ?? []),
  }));
}

export type RunViewFlags = {
  isGenerating: boolean;
  compileDone: boolean;
  testDone: boolean;
  shipReady: boolean;
  failed: boolean;
};

export function flagsFromSnapshot(snapshot: BuildRunSnapshot): RunViewFlags {
  // The run-level status is authoritative: a stage row can stay "failed" from
  // an earlier attempt (quota retry, repaired fix round, a resume that
  // recomposed the plan) while the run itself settled green.
  const failed = snapshot.status === "failed";
  const done = snapshot.status === "completed";
  const validateStages = snapshot.stages.filter(
    (s) => laneFor(s) === "validate" && s.kind !== "parallel",
  );
  const validated =
    validateStages.length > 0 &&
    validateStages.every((s) => s.status === "complete");
  return {
    isGenerating: snapshot.status === "running",
    // Real runs compile and smoke inside the workflow — both gates follow the
    // validate lane instead of manual buttons.
    compileDone: validated || done,
    testDone: validated || done,
    shipReady: done,
    failed,
  };
}

/** Assistant chat message for a settled run. Prefers the curate agent's own
 *  structured report over anything synthesized. */
export function completionMessage(snapshot: BuildRunSnapshot): string {
  if (snapshot.error) {
    return `The build hit an error: ${snapshot.error}\n\nRun: \`${snapshot.runId}\`.`;
  }
  if (snapshot.status === "failed") {
    const failedStage = snapshot.stages.find((s) => s.status === "failed");
    return `The build failed${failedStage ? ` at **${failedStage.label}**` : ""}. Check the activity log, adjust your prompt, and run again.\n\nRun: \`${snapshot.runId}\`.`;
  }
  if (snapshot.curation?.summary) {
    const followUps = snapshot.curation.followUps.trim();
    return [
      snapshot.curation.summary,
      ...(followUps ? [`**Suggested follow-ups:** ${followUps}`] : []),
      "Next: ship to Projects or download the files.",
    ].join("\n\n");
  }
  const summary = snapshot.result?.summary ?? `\`${snapshot.app}\` built and validated.`;
  return `${summary}\n\nNext: ship to Projects or download the files.`;
}
