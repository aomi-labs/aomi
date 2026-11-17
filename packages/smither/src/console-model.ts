/**
 * Pure, DOM-free model for the branded console UI. Folds the gateway's
 * `GatewayEventFrame` stream into a per-stage status map — the browser entry
 * (`ui/aomi-smither.tsx`) renders from this, and vitest exercises it in Node.
 *
 * This mirrors the TUI's `reduceEvent` (cli.tsx) but over the WIRE frame shape
 * (`{ event: string, payload }`) rather than the typed `SmithersEvent` union
 * the in-process engine hands the TUI.
 */

export type StageStatus =
  | "pending"
  | "running"
  | "complete"
  | "failed"
  | "waiting";

/** One row of the branded stage rail; shape of each `props.stages[]` entry. */
export type UiStage = {
  id: string;
  label: string;
  kind: string;
  /** Clarify metadata (question + options) rides on the stage so the browser
   *  UI can render option buttons without a second data path. */
  clarify?: {
    question: string;
    summary?: string;
    options: Array<{ key: string; label: string; summary?: string }>;
  };
};

/** Minimal view of a gateway run-event frame (see `GatewayEventFrame`). */
export type EventFrameLike = {
  event: string;
  payload?: Record<string, unknown> | undefined;
  seq: number;
};

/**
 * Unwrap the gateway transport envelope. `streamRunEvents` frames arrive as
 * `{event: "run.event", seq: <transport>, payload: {seq: <run>, event:
 * "<SmithersEvent type>", payload: <the event object>}}` — the engine event is
 * double-nested. Returns a flat `{event, payload, seq}` the reducers read;
 * frames that are already flat (or non-run channels like heartbeats) pass
 * through unchanged.
 */
export function unwrapFrame(frame: EventFrameLike): EventFrameLike {
  if (!frame.event.startsWith("run.")) return frame;
  const inner = frame.payload as
    | { event?: unknown; payload?: unknown; seq?: unknown }
    | undefined;
  if (!inner || typeof inner.event !== "string") return frame;
  return {
    event: inner.event,
    payload:
      inner.payload && typeof inner.payload === "object"
        ? (inner.payload as Record<string, unknown>)
        : undefined,
    seq: typeof inner.seq === "number" ? inner.seq : frame.seq,
  };
}

/** Node id carried by an event frame — the engine puts it in the payload. */
export function eventNodeId(frame: EventFrameLike): string | undefined {
  const payload = frame.payload ?? {};
  const direct = payload.nodeId;
  if (typeof direct === "string" && direct) return direct;
  const node = payload.node;
  if (node && typeof node === "object") {
    const id = (node as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

/**
 * Collapse a raw node id onto the stage-rail key. The validate/repair loop runs
 * as two child nodes (`<package>:validate`, `<package>:fix`) that both report into the
 * single `<package>:validate-loop` rail row — same collapse the TUI does.
 */
export function stageKeyForNodeId(nodeIdValue: string): string {
  if (nodeIdValue.endsWith(":validate") || nodeIdValue.endsWith(":fix")) {
    const prefix = nodeIdValue.slice(0, nodeIdValue.lastIndexOf(":"));
    return `${prefix}:validate-loop`;
  }
  return nodeIdValue;
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Status implied by a single frame, or undefined if the frame says nothing
 * about node lifecycle. Prefers an explicit `payload.status`, then falls back
 * to matching the event name — both case-insensitively, since the wire may
 * carry PascalCase (`NodeStarted`) or dotted-lowercase (`node.started`).
 */
export function statusFromFrame(
  frame: EventFrameLike,
): StageStatus | undefined {
  const status = String(frame.payload?.status ?? "").toLowerCase();
  if (
    includesAny(status, [
      "fulfilled",
      "succeed",
      "finished",
      "complete",
      "success",
    ])
  ) {
    return "complete";
  }
  if (includesAny(status, ["rejected", "failed", "error"])) return "failed";
  if (includesAny(status, ["waiting", "pending_approval", "needs_approval"]))
    return "waiting";
  if (includesAny(status, ["running", "in_progress", "started", "active"]))
    return "running";

  const event = frame.event.toLowerCase();
  if (
    includesAny(event, ["waiting", "approvalrequested", "approval_requested"])
  )
    return "waiting";
  if (includesAny(event, ["fail", "error", "reject"])) return "failed";
  if (includesAny(event, ["finish", "succeed", "complete", "fulfil"]))
    return "complete";
  if (includesAny(event, ["retry"])) return "running";
  if (includesAny(event, ["start", "running"])) return "running";
  // A node emitting heartbeats or agent activity is running, even when its
  // `started` frame predates the gateway's replay window.
  if (includesAny(event, ["heartbeat", "agent."])) return "running";
  return undefined;
}

/**
 * Fold frames (any order — sorted by seq internally) into a status per stage
 * id. Monotonic like the TUI: a stage that reached `complete` is never pulled
 * back to `running` by a later loop iteration, but `failed`/`waiting` always
 * win (they need the operator's eye).
 */
export function reduceStageStatuses(
  stages: UiStage[],
  frames: EventFrameLike[],
): Record<string, StageStatus> {
  const known = new Set(stages.map((stage) => stage.id));
  const result: Record<string, StageStatus> = {};
  const ordered = [...frames].sort((a, b) => a.seq - b.seq);

  for (const frame of ordered) {
    const rawNodeId = eventNodeId(frame);
    if (!rawNodeId) continue;
    const key = stageKeyForNodeId(rawNodeId);
    if (!known.has(key)) continue;
    const next = statusFromFrame(frame);
    if (!next) continue;
    const current = result[key];
    if (current === "complete" && next === "running") continue;
    if (current === "failed" && next !== "failed") continue;
    result[key] = next;
  }
  return result;
}

/** A devtools-snapshot tree node (loose — we only read `task.nodeId` + kids). */
export type SnapshotNode = {
  task?: { nodeId?: string } | null;
  children?: SnapshotNode[] | null;
};

/**
 * The set of rail-stage ids that actually mounted in a run, read from the
 * devtools snapshot tree. Only executed nodes appear in the tree, so this
 * distinguishes "ran" from "never reached" — the basis for showing a finished
 * run's rail without an event stream (which the gateway doesn't backfill for
 * runs that completed before the console attached). Loop children collapse onto
 * the `validate-loop` rail, same as the live reducer.
 */
export function collectExecutedStageIds(
  root: SnapshotNode | null | undefined,
  knownIds: Set<string>,
): Set<string> {
  const out = new Set<string>();
  const visit = (node: SnapshotNode | null | undefined): void => {
    if (!node) return;
    const nodeId = node.task?.nodeId;
    if (typeof nodeId === "string") {
      const key = stageKeyForNodeId(nodeId);
      if (knownIds.has(key)) out.add(key);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return out;
}

/** One-line activity summary for the event feed. */
export function summarizeFrame(frame: EventFrameLike): string {
  const nodeId = eventNodeId(frame);
  const status = frame.payload?.status;
  return [nodeId, typeof status === "string" ? `· ${status}` : ""]
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** Coarse class for color-coding a feed row. */
export function frameTone(
  frame: EventFrameLike,
): "error" | "wait" | "node" | "muted" {
  const event = frame.event.toLowerCase();
  if (includesAny(event, ["fail", "error", "reject"])) return "error";
  if (includesAny(event, ["waiting", "approval"])) return "wait";
  if (eventNodeId(frame)) return "node";
  return "muted";
}
