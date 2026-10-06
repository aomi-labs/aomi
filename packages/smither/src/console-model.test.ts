import { describe, expect, it } from "vitest";
import {
  collectExecutedStageIds,
  eventNodeId,
  frameTone,
  reduceStageStatuses,
  stageKeyForNodeId,
  statusFromFrame,
  summarizeFrame,
  unwrapFrame,
  type EventFrameLike,
  type SnapshotNode,
  type UiStage,
} from "../console-model";

const stages: UiStage[] = [
  { id: "demo:binaries", label: "Sync SDK", kind: "compute" },
  { id: "demo:codegen", label: "Codegen", kind: "compute" },
  { id: "demo:curate", label: "Curate", kind: "agent" },
  { id: "demo:validate-loop", label: "Validate/repair", kind: "loop" },
  { id: "demo:deploy-gate", label: "Deploy gate", kind: "approval" },
];

function frame(event: string, payload: Record<string, unknown>, seq: number): EventFrameLike {
  return { event, payload, seq };
}

describe("unwrapFrame", () => {
  // Live wire shape observed on the gateway's streamRunEvents channel: the
  // engine event is double-nested under the transport envelope.
  it("unwraps the run.event transport envelope", () => {
    const wire = frame(
      "run.event",
      {
        streamId: "s1",
        runId: "r1",
        seq: 42,
        event: "NodeStarted",
        payload: { nodeId: "demo:curate", iteration: 0 },
      },
      7,
    );
    const flat = unwrapFrame(wire);
    expect(flat.event).toBe("NodeStarted");
    expect(flat.seq).toBe(42);
    expect(eventNodeId(flat)).toBe("demo:curate");
    expect(statusFromFrame(flat)).toBe("running");
  });

  it("passes flat frames and non-event channels through", () => {
    const flat = frame("NodeFinished", { nodeId: "demo:codegen" }, 3);
    expect(unwrapFrame(flat)).toEqual(flat);
    const heartbeat = frame("run.heartbeat", { streamId: "s1" }, 4);
    expect(unwrapFrame(heartbeat)).toEqual(heartbeat);
  });

  it("treats node heartbeats and agent activity as running (replay window gap)", () => {
    expect(statusFromFrame(frame("task.heartbeat", { nodeId: "demo:curate" }, 5))).toBe("running");
    expect(statusFromFrame(frame("agent.event", { nodeId: "demo:curate" }, 6))).toBe("running");
    const rail = reduceStageStatuses(stages, [
      frame("task.heartbeat", { nodeId: "demo:curate" }, 5),
    ]);
    expect(rail["demo:curate"]).toBe("running");
  });
});

describe("console-model", () => {
  it("reads the node id from the event payload", () => {
    expect(eventNodeId(frame("NodeStarted", { nodeId: "demo:codegen" }, 1))).toBe("demo:codegen");
    expect(eventNodeId(frame("x", { node: { id: "demo:curate" } }, 1))).toBe("demo:curate");
    expect(eventNodeId(frame("RunStatusChanged", { status: "running" }, 1))).toBeUndefined();
  });

  it("collapses loop child nodes onto the validate-loop rail", () => {
    expect(stageKeyForNodeId("demo:validate")).toBe("demo:validate-loop");
    expect(stageKeyForNodeId("demo:fix")).toBe("demo:validate-loop");
    expect(stageKeyForNodeId("demo:codegen")).toBe("demo:codegen");
  });

  it("maps event names and payload status to a stage status", () => {
    expect(statusFromFrame(frame("NodeStarted", {}, 1))).toBe("running");
    expect(statusFromFrame(frame("NodeFinished", {}, 1))).toBe("complete");
    expect(statusFromFrame(frame("NodeFailed", {}, 1))).toBe("failed");
    expect(statusFromFrame(frame("NodeWaitingApproval", {}, 1))).toBe("waiting");
    // payload.status wins over a neutral event name
    expect(statusFromFrame(frame("node.updated", { status: "fulfilled" }, 1))).toBe("complete");
    expect(statusFromFrame(frame("node.updated", { status: "rejected" }, 1))).toBe("failed");
  });

  it("folds a run's event stream into per-stage statuses", () => {
    const frames: EventFrameLike[] = [
      frame("NodeStarted", { nodeId: "demo:binaries" }, 1),
      frame("NodeFinished", { nodeId: "demo:binaries" }, 2),
      frame("NodeStarted", { nodeId: "demo:codegen" }, 3),
      frame("NodeFinished", { nodeId: "demo:codegen" }, 4),
      frame("NodeStarted", { nodeId: "demo:curate" }, 5),
      frame("NodeWaitingApproval", { nodeId: "demo:deploy-gate" }, 6),
    ];
    const status = reduceStageStatuses(stages, frames);
    expect(status["demo:binaries"]).toBe("complete");
    expect(status["demo:codegen"]).toBe("complete");
    expect(status["demo:curate"]).toBe("running");
    expect(status["demo:deploy-gate"]).toBe("waiting");
    // untouched stage stays absent (renders as pending)
    expect(status["demo:validate-loop"]).toBeUndefined();
  });

  it("keeps a completed stage green when a later loop iteration restarts", () => {
    const frames: EventFrameLike[] = [
      frame("NodeStarted", { nodeId: "demo:validate" }, 1),
      frame("NodeFinished", { nodeId: "demo:validate" }, 2),
      // a stray later start (e.g. re-render/replay) must not demote to running
      frame("NodeStarted", { nodeId: "demo:fix" }, 3),
    ];
    expect(reduceStageStatuses(stages, frames)["demo:validate-loop"]).toBe("complete");
  });

  it("is order-independent (sorts by seq)", () => {
    const shuffled: EventFrameLike[] = [
      frame("NodeFinished", { nodeId: "demo:codegen" }, 4),
      frame("NodeStarted", { nodeId: "demo:codegen" }, 3),
    ];
    expect(reduceStageStatuses(stages, shuffled)["demo:codegen"]).toBe("complete");
  });

  it("ignores events for nodes not on the rail", () => {
    const frames = [frame("NodeStarted", { nodeId: "demo:ghost" }, 1)];
    expect(reduceStageStatuses(stages, frames)).toEqual({});
  });

  it("collects executed stage ids from a devtools snapshot tree", () => {
    // Mirrors a real getDevToolsSnapshot root: validate runs as a loop child.
    const root: SnapshotNode = {
      children: [
        {
          children: [
            { task: { nodeId: "demo:binaries" } },
            { task: { nodeId: "demo:codegen" } },
            { children: [{ children: [{ task: { nodeId: "demo:validate" } }] }] },
            { task: { nodeId: "demo:deploy-gate" } },
          ],
        },
      ],
    };
    const executed = collectExecutedStageIds(root, new Set(stages.map((s) => s.id)));
    expect([...executed].sort()).toEqual([
      "demo:binaries",
      "demo:codegen",
      "demo:deploy-gate",
      "demo:validate-loop",
    ]);
    // curate never mounted → absent (renders pending, not falsely complete)
    expect(executed.has("demo:curate")).toBe(false);
  });

  it("returns an empty executed set for a missing snapshot", () => {
    expect(collectExecutedStageIds(undefined, new Set(["demo:binaries"])).size).toBe(0);
  });

  it("tones and summarizes frames for the activity feed", () => {
    expect(frameTone(frame("NodeFailed", { nodeId: "demo:codegen" }, 1))).toBe("error");
    expect(frameTone(frame("ApprovalRequested", { nodeId: "demo:deploy-gate" }, 1))).toBe("wait");
    expect(frameTone(frame("NodeStarted", { nodeId: "demo:codegen" }, 1))).toBe("node");
    expect(frameTone(frame("RunStatusChanged", {}, 1))).toBe("muted");
    expect(summarizeFrame(frame("NodeStarted", { nodeId: "demo:codegen", status: "running" }, 1))).toBe(
      "demo:codegen · running",
    );
  });
});
