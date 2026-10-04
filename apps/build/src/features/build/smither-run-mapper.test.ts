import { describe, expect, it } from "vitest";

import type {
  BuildRunSnapshot,
  BuildRunStage,
} from "./run-contracts";
import {
  completionMessage,
  flagsFromSnapshot,
  nodesFromSnapshot,
  streamEventsFromSnapshot,
} from "./smither-run-mapper";

function stage(
  phase: string,
  status: BuildRunStage["status"],
  kind: BuildRunStage["kind"] = "compute",
): BuildRunStage {
  return { id: `my-app:${phase}`, label: phase, kind, status };
}

function snapshot(
  stages: BuildRunStage[],
  status: BuildRunSnapshot["status"] = "running",
  extra: Partial<BuildRunSnapshot> = {},
): BuildRunSnapshot {
  return {
    runId: "smither-my-app-123",
    app: "my-app",
    status,
    stages,
    approvals: [],
    lines: [],
    fileTree: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

/** The classic composition's stage rows, mid-codegen. */
const midRun = snapshot([
  stage("binaries", "complete"),
  stage("codegen", "running"),
  stage("curate", "pending", "agent"),
  stage("validate-loop", "pending", "loop"),
  stage("result", "pending"),
]);

describe("nodesFromSnapshot", () => {
  it("maps stages to product-labeled plan nodes", () => {
    const nodes = nodesFromSnapshot(midRun);
    expect(nodes.map((n) => [n.id, n.role, n.status])).toEqual([
      ["my-app:binaries", "Setup", "done"],
      ["my-app:codegen", "Generator", "active"],
      ["my-app:curate", "Reviewer", "pending"],
      ["my-app:validate-loop", "Tester", "pending"],
      ["my-app:result", "Shipper", "pending"],
    ]);
  });

  it("marks waiting and failed stages active with a detail line", () => {
    const nodes = nodesFromSnapshot(
      snapshot([stage("deploy-gate", "waiting", "approval")]),
    );
    expect(nodes[0].status).toBe("active");
    expect(nodes[0].detail).toMatch(/decision/i);
  });
});

describe("streamEventsFromSnapshot", () => {
  it("folds stages into the four timeline lanes", () => {
    const events = streamEventsFromSnapshot(midRun);
    expect(events.map((e) => [e.stage, e.status])).toEqual([
      ["plan", "done"],
      ["generate", "active"],
      ["validate", "pending"],
      ["ready", "pending"],
    ]);
  });

  it("keeps ready pending until deploy/result stages finish", () => {
    const events = streamEventsFromSnapshot(
      snapshot([
        stage("binaries", "complete"),
        stage("codegen", "complete"),
        stage("validate-loop", "complete", "loop"),
        stage("result", "running"),
      ]),
    );
    expect(events.find((e) => e.stage === "validate")?.status).toBe("done");
    expect(events.find((e) => e.stage === "ready")?.status).toBe("active");
  });
});

describe("flagsFromSnapshot", () => {
  it("opens the verify gates when the validate lane is green", () => {
    const flags = flagsFromSnapshot(
      snapshot(
        [
          stage("codegen", "complete"),
          stage("validate-loop", "complete", "loop"),
          stage("result", "running"),
        ],
        "running",
      ),
    );
    expect(flags.compileDone).toBe(true);
    expect(flags.testDone).toBe(true);
    expect(flags.shipReady).toBe(false);
  });

  it("ships only when the run completes without failures", () => {
    expect(
      flagsFromSnapshot(snapshot([stage("result", "complete")], "completed"))
        .shipReady,
    ).toBe(true);
    expect(
      flagsFromSnapshot(snapshot([stage("codegen", "failed")], "failed")),
    ).toMatchObject({ shipReady: false, failed: true, isGenerating: false });
  });

  it("trusts the run status over stale failed stage rows", () => {
    // A quota-retried or recomposed run can settle green while an old
    // attempt's stage row still reads failed.
    const flags = flagsFromSnapshot(
      snapshot(
        [stage("curate", "failed", "agent"), stage("result", "complete")],
        "completed",
      ),
    );
    expect(flags.failed).toBe(false);
    expect(flags.shipReady).toBe(true);
  });
});

describe("streamEventsFromSnapshot times", () => {
  it("carries the latest member-stage transition time per lane", () => {
    const events = streamEventsFromSnapshot(
      snapshot([
        { ...stage("binaries", "complete"), time: "10:00:01" },
        { ...stage("codegen", "complete"), time: "10:00:05" },
        { ...stage("curate", "running", "agent"), time: "10:00:09" },
      ]),
    );
    expect(events.find((e) => e.stage === "plan")?.time).toBe("10:00:01");
    expect(events.find((e) => e.stage === "generate")?.time).toBe("10:00:09");
  });
});

describe("completionMessage", () => {
  it("includes the failure detail and run id", () => {
    const message = completionMessage(
      snapshot([], "failed", { error: "Quota unavailable", runId: "run-123" }),
    );
    expect(message).toContain("Quota unavailable");
    expect(message).toContain("run-123");
  });
  it("prefers the curate agent's structured report", () => {
    const message = completionMessage(
      snapshot([], "completed", {
        curation: {
          summary: "Curated 11 user-centric tools wrapping 17 operations.",
          changedFiles: "src/tool.rs",
          followUps: "Run the e2e harness.",
        },
        result: { status: "complete", summary: "my-app built and validated." },
      }),
    );
    expect(message).toContain("Curated 11 user-centric tools");
    expect(message).toContain("Run the e2e harness.");
    expect(message).not.toContain("my-app built and validated.");
  });

  it("uses the run summary when no curation report exists", () => {
    const message = completionMessage(
      snapshot([], "completed", {
        result: { status: "complete", summary: "my-app built and validated." },
      }),
    );
    expect(message).toContain("my-app built and validated.");
  });

  it("names the failed stage", () => {
    const message = completionMessage(
      snapshot([stage("codegen", "failed")], "failed"),
    );
    expect(message).toContain("codegen");
  });
});
