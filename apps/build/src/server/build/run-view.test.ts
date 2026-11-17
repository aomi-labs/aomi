import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  artifactFromOutputs,
  curationFromOutputs,
  runStatusFromView,
  stageStatusesFromView,
} from "./run-view";

const telemetry = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("@/server/failures", () => ({
  buildFailures: {
    handle: (input: { error: unknown; context: Record<string, unknown> }) =>
      telemetry.capture(input.error, { ...input.context, status: 500 }),
  },
}));

beforeEach(() => {
  telemetry.capture.mockReset();
});

const fold = (nodeId: string) =>
  nodeId === "package:validate" || nodeId === "package:fix"
    ? "package:validate-loop"
    : nodeId;

function node(nodeId: string, state: string, updatedAtMs = 0) {
  return { nodeId, state, updatedAtMs };
}

describe("runStatusFromView", () => {
  it("maps store statuses onto wire statuses", () => {
    expect(runStatusFromView("finished")).toBe("completed");
    expect(runStatusFromView("continued")).toBe("completed");
    expect(runStatusFromView("cancelled")).toBe("failed");
    expect(runStatusFromView("waiting-approval")).toBe("waiting-approval");
    expect(runStatusFromView("waiting-timer")).toBe("running");
    expect(runStatusFromView(null)).toBeNull();
  });
});

describe("stageStatusesFromView", () => {
  it("derives stage statuses from durable node states", () => {
    const merged = stageStatusesFromView(
      {
        status: "running",
        nodes: [
          node("package:binaries", "finished"),
          node("package:codegen", "finished"),
          node("package:curate", "running"),
        ],
      },
      fold,
      {},
    );
    expect(merged).toMatchObject({
      "package:binaries": "complete",
      "package:codegen": "complete",
      "package:curate": "running",
    });
  });

  it("folds loop body nodes onto the loop stage, most advanced wins", () => {
    const merged = stageStatusesFromView(
      {
        status: "running",
        nodes: [
          node("package:validate", "finished"),
          node("package:fix", "running"),
        ],
      },
      fold,
      {},
    );
    // A later repair round runs while the validate row is finished — the
    // folded stage should not regress below the strongest durable signal.
    expect(merged["package:validate-loop"]).toBe("complete");
  });

  it("settles running/waiting rows when the run finished (replays)", () => {
    const merged = stageStatusesFromView(
      { status: "finished", nodes: [node("package:curate", "running")] },
      fold,
      { "package:result": "running" },
    );
    expect(merged["package:curate"]).toBe("complete");
    expect(merged["package:result"]).toBe("complete");
  });

  it("keeps live-only signals the store has not written yet", () => {
    const merged = stageStatusesFromView(
      { status: "running", nodes: [] },
      fold,
      { "package:binaries": "running" },
    );
    expect(merged["package:binaries"]).toBe("running");
  });
});

describe("curationFromOutputs", () => {
  it("reads the curation row and stringifies optional fields", () => {
    expect(
      curationFromOutputs({
        curation: [
          { summary: "did things", changedFiles: "", followUps: "next" },
        ],
      }),
    ).toEqual({ summary: "did things", changedFiles: "", followUps: "next" });
    expect(curationFromOutputs({})).toBeUndefined();
  });
});

describe("artifactFromOutputs", () => {
  const tree = [{ path: "package", type: "folder", children: [] }];

  it("parses the embedded tree and tarball", () => {
    expect(
      artifactFromOutputs({
        result: [
          {
            summary: "done",
            fileTreeJson: JSON.stringify(tree),
            crateTarB64: "dGFy",
            artifactWarning: "",
          },
        ],
      }),
    ).toEqual({ fileTree: tree, crateTarB64: "dGFy", warning: "" });
  });

  it("degrades malformed tree JSON to empty and absent artifacts to undefined", () => {
    expect(
      artifactFromOutputs({
        result: [
          { summary: "done", fileTreeJson: "{oops", crateTarB64: "dGFy" },
        ],
      }),
    ).toEqual({ fileTree: [], crateTarB64: "dGFy", warning: "" });
    expect(telemetry.capture).toHaveBeenCalledOnce();
    expect(telemetry.capture.mock.calls[0]?.[1]).toEqual({
      routeFamily: "/api/build/runs",
      operation: "build.artifact_tree_parse",
      status: 500,
    });
    expect(
      artifactFromOutputs({ result: [{ summary: "done" }] }),
    ).toBeUndefined();
    expect(artifactFromOutputs({})).toBeUndefined();
  });
});
