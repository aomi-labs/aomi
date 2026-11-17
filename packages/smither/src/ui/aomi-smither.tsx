/**
 * Aomi-branded workflow console — the custom Gateway UI entry.
 *
 * Bundled at request time by the gateway (`Bun.build`, browser target) and
 * served at `/workflows/<package>`. It renders the run's *named plan stages*
 * (passed as `props.stages`) coloured by the live event stream, plus a
 * first-class approvals panel — a friendlier lens on the same run the built-in
 * operator console shows. All data comes from the stable `gateway-react` hooks;
 * no internal snapshot shapes are relied on.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createGatewayReactRoot,
  useGatewayActions,
  useGatewayApprovals,
  useGatewayNodeOutput,
  useGatewayRun,
  useGatewayRunEvents,
  useGatewayRuns,
  useSmithersGateway,
} from "smithers-orchestrator/gateway-react";
import {
  collectExecutedStageIds,
  frameTone,
  reduceStageStatuses,
  summarizeFrame,
  unwrapFrame,
  type EventFrameLike,
  type SnapshotNode,
  type StageStatus,
  type UiStage,
} from "../console-model";

// --- boot config -----------------------------------------------------------

type BootProps = {
  packageName?: string;
  stages?: UiStage[];
  deploy?: boolean;
  smoke?: boolean;
  /** Loopback decision endpoint (console.ts startDecisionServer). Present when
   *  the console runs beside a live run api; carries select-mode clarify
   *  decisions that the stock gateway approve route drops. */
  decideUrl?: string;
};

const boot = (
  globalThis as {
    __SMITHERS_GATEWAY_UI__?: {
      workflowKey?: string | null;
      props?: BootProps;
    };
  }
).__SMITHERS_GATEWAY_UI__;
const workflowKey = boot?.workflowKey ?? "";
const bootProps: BootProps = boot?.props ?? {};
const appName = bootProps.packageName ?? workflowKey ?? "package";
const planStages: UiStage[] = Array.isArray(bootProps.stages)
  ? bootProps.stages
  : [];

// --- loose row views over the gateway payloads -----------------------------

type RunRow = {
  runId: string;
  workflowKey?: string;
  status?: string;
  createdAtMs?: number;
  summary?: unknown;
};
type ApprovalRow = {
  runId: string;
  nodeId: string;
  iteration: number;
  requestTitle?: string;
  requestSummary?: string;
};

// --- palette (aomi design tokens) ------------------------------------------

const STATUS_COLOR: Record<StageStatus, string> = {
  pending: "var(--aomi-muted)",
  running: "var(--aomi-info)",
  complete: "var(--aomi-success)",
  failed: "var(--aomi-danger)",
  waiting: "var(--aomi-warning)",
};
const STATUS_LABEL: Record<StageStatus, string> = {
  pending: "pending",
  running: "running",
  complete: "done",
  failed: "failed",
  waiting: "waiting",
};

function StatusDot({ status }: { status: StageStatus }) {
  return (
    <span
      className={`dot ${status === "running" ? "dot-pulse" : ""}`}
      style={{
        background: status === "pending" ? "transparent" : STATUS_COLOR[status],
        borderColor: STATUS_COLOR[status],
      }}
      aria-label={status}
    />
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const color =
    normalized.includes("fail") || normalized.includes("error")
      ? "var(--aomi-danger)"
      : normalized.includes("wait")
        ? "var(--aomi-warning)"
        : normalized.includes("finish") || normalized.includes("complete")
          ? "var(--aomi-success)"
          : "var(--aomi-info)";
  return (
    <span className="pill" style={{ color, borderColor: color }}>
      {status}
    </span>
  );
}

// --- package -------------------------------------------------------------------

function App() {
  const runsState = useGatewayRuns();
  const [selectedRunId, setSelectedRunId] = useState<string>(
    () =>
      new URLSearchParams(globalThis.location?.search ?? "").get("runId") ?? "",
  );
  const [selectedNode, setSelectedNode] = useState<string | undefined>(
    undefined,
  );

  const runs = useMemo<RunRow[]>(() => {
    const rows = (runsState.data as RunRow[] | undefined) ?? [];
    return rows
      .filter((row) => !workflowKey || row.workflowKey === workflowKey)
      .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  }, [runsState.data]);

  // Auto-select the newest run once the list arrives (unless ?runId= pinned one).
  useEffect(() => {
    if (!selectedRunId && runs[0]) setSelectedRunId(runs[0].runId);
  }, [runs, selectedRunId]);

  const runState = useGatewayRun(selectedRunId || undefined);
  const run = runState.data as RunRow | undefined;
  // afterSeq: 0 replays the run's whole persisted history, then tails live —
  // so a completed or already-running run (observer mode) lights up its rail,
  // not just runs we watch from their first event.
  const { events, streaming } = useGatewayRunEvents(
    selectedRunId || undefined,
    {
      afterSeq: 0,
      maxEvents: 500,
    },
  );
  // Unwrap the transport envelope (run.event → engine event) and drop frames
  // that carry no engine event (heartbeats, gap resyncs).
  const frames = useMemo<EventFrameLike[]>(
    () =>
      (events as unknown as EventFrameLike[])
        .map(unwrapFrame)
        .filter((frame) => !frame.event.startsWith("run.")),
    [events],
  );

  const liveStatus = useMemo(
    () => reduceStageStatuses(planStages, frames),
    [frames],
  );

  // Snapshot fallback: the gateway doesn't backfill the event stream for a run
  // that finished before we attached, so derive which stages actually mounted
  // from the persisted devtools tree. Live events (above) always take priority.
  // `getDevToolsSnapshot` is an HTTP-only route (not in the typed RPC union, so
  // called via the client's rpcRaw escape hatch).
  const gateway = useSmithersGateway();
  const [snapshotRoot, setSnapshotRoot] = useState<SnapshotNode | undefined>(
    undefined,
  );
  useEffect(() => {
    setSnapshotRoot(undefined);
    if (!selectedRunId) return;
    let cancelled = false;
    void (
      gateway as unknown as {
        rpcRaw: (m: string, p?: unknown) => Promise<unknown>;
      }
    )
      .rpcRaw("getDevToolsSnapshot", { runId: selectedRunId })
      .then((payload) => {
        if (!cancelled) {
          setSnapshotRoot(
            (payload as { root?: SnapshotNode } | undefined)?.root,
          );
        }
      })
      .catch(() => {
        /* no snapshot (e.g. run just started) — the event stream covers it */
      });
    return () => {
      cancelled = true;
    };
  }, [gateway, selectedRunId, run?.status]);

  const runStatusLower = (run?.status ?? "").toLowerCase();
  const runSucceeded =
    runStatusLower.includes("finish") ||
    runStatusLower.includes("succeed") ||
    runStatusLower.includes("complete");
  const executedStages = useMemo(
    () =>
      collectExecutedStageIds(
        snapshotRoot,
        new Set(planStages.map((stage) => stage.id)),
      ),
    [snapshotRoot],
  );

  const stageStatus = useMemo<Record<string, StageStatus>>(() => {
    const merged: Record<string, StageStatus> = {};
    for (const stage of planStages) {
      // Live event status wins; else a mounted stage on a succeeded run is done.
      merged[stage.id] =
        liveStatus[stage.id] ??
        (executedStages.has(stage.id) && runSucceeded ? "complete" : "pending");
    }
    return merged;
  }, [liveStatus, executedStages, runSucceeded]);

  const approvalsState = useGatewayApprovals();
  const pendingApprovals = useMemo<ApprovalRow[]>(() => {
    const rows = (approvalsState.data as ApprovalRow[] | undefined) ?? [];
    return rows.filter((row) => row.runId === selectedRunId);
  }, [approvalsState.data, selectedRunId]);

  const actions = useGatewayActions();
  const decide = useCallback(
    (approval: ApprovalRow, approved: boolean, selected?: string) => {
      // Selections need the loopback decision endpoint — the gateway approve
      // route drops decision payloads. Binary decisions prefer it too when
      // available (one write path), falling back to the gateway RPC.
      if (bootProps.decideUrl) {
        void fetch(bootProps.decideUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId: approval.runId,
            nodeId: approval.nodeId,
            iteration: approval.iteration,
            approve: approved,
            ...(selected ? { selected } : {}),
          }),
        }).catch(() => {
          /* pending card stays until the next approvals pull re-confirms */
        });
        return;
      }
      void actions
        .submitApproval({
          runId: approval.runId,
          nodeId: approval.nodeId,
          iteration: approval.iteration,
          decision: selected ? { selected, notes: null } : { approved },
        })
        .catch(() => {
          /* the approvals collection re-pulls on invalidate; nothing to do here */
        });
    },
    [actions],
  );

  const nodeOutputState = useGatewayNodeOutput({
    runId: selectedRunId || undefined,
    nodeId: selectedNode,
  });

  const runStatus =
    run?.status ?? runs.find((r) => r.runId === selectedRunId)?.status ?? "";
  const summaryText =
    run?.summary && typeof run.summary === "object"
      ? (run.summary as { summary?: string }).summary
      : typeof run?.summary === "string"
        ? run.summary
        : undefined;

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="wordmark">aomi</span>
          <span className="wordmark-sub">smither</span>
        </div>
        <div className="gateway-status">
          <span className={`live ${streaming ? "live-on" : ""}`} />
          {streaming ? "streaming" : "online"}
        </div>
      </header>

      <section className="hero">
        <div>
          <div className="eyebrow">workflow</div>
          <h1 className="package-title">{appName}</h1>
        </div>
        <div className="hero-right">
          {runStatus ? <StatusPill status={runStatus} /> : null}
          {runs.length > 1 ? (
            <select
              className="run-select"
              value={selectedRunId}
              onChange={(event) => {
                setSelectedRunId(event.target.value);
                setSelectedNode(undefined);
              }}
            >
              {runs.map((row) => (
                <option key={row.runId} value={row.runId}>
                  {new Date(row.createdAtMs ?? 0).toLocaleString()} ·{" "}
                  {row.status ?? "?"}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </section>

      {summaryText ? <div className="summary-note">{summaryText}</div> : null}

      {pendingApprovals.length > 0 ? (
        <section className="approvals">
          {pendingApprovals.map((approval) => {
            const stage = planStages.find((s) => s.id === approval.nodeId);
            if (stage?.clarify) {
              return (
                <div
                  className="approval-card approval-clarify"
                  key={`${approval.nodeId}:${approval.iteration}`}
                >
                  <div className="approval-body">
                    <div className="approval-title">
                      {stage.clarify.question}
                    </div>
                    {stage.clarify.summary ? (
                      <div className="approval-summary">
                        {stage.clarify.summary}
                      </div>
                    ) : null}
                    <div className="clarify-options">
                      {stage.clarify.options.map((option, index) => (
                        <button
                          key={option.key}
                          className={`btn ${index === 0 ? "btn-primary" : "btn-ghost"}`}
                          title={option.summary}
                          onClick={() => decide(approval, true, option.key)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div
                className="approval-card"
                key={`${approval.nodeId}:${approval.iteration}`}
              >
                <div className="approval-body">
                  <div className="approval-title">
                    {approval.requestTitle ?? `Approve ${approval.nodeId}?`}
                  </div>
                  {approval.requestSummary ? (
                    <div className="approval-summary">
                      {approval.requestSummary}
                    </div>
                  ) : null}
                </div>
                <div className="approval-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => decide(approval, true)}
                  >
                    Approve
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => decide(approval, false)}
                  >
                    Deny
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      <section className="card">
        <div className="card-title">Build stages</div>
        {planStages.length === 0 ? (
          <div className="empty">No stage metadata for this workflow.</div>
        ) : (
          <ul className="stage-rail">
            {planStages.map((stage) => {
              const status = stageStatus[stage.id] ?? "pending";
              const active = stage.id === selectedNode;
              return (
                <li key={stage.id}>
                  <button
                    className={`stage-row ${active ? "stage-active" : ""}`}
                    onClick={() =>
                      setSelectedNode((prev) =>
                        prev === stage.id ? undefined : stage.id,
                      )
                    }
                  >
                    <StatusDot status={status} />
                    <span className="stage-label">{stage.label}</span>
                    <span
                      className="stage-status"
                      style={{ color: STATUS_COLOR[status] }}
                    >
                      {STATUS_LABEL[status]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {selectedNode ? (
        <section className="card">
          <div className="card-title">
            Output · <span className="mono">{selectedNode}</span>
            {nodeOutputState.loading ? (
              <span className="muted"> (loading)</span>
            ) : null}
          </div>
          {nodeOutputState.data ? (
            <pre className="code">
              {JSON.stringify(nodeOutputState.data, null, 2)}
            </pre>
          ) : (
            <div className="empty">No output recorded for this stage yet.</div>
          )}
        </section>
      ) : null}

      <section className="card">
        <div className="card-title">
          Activity {streaming ? <span className="muted">· live</span> : null}
        </div>
        {frames.length === 0 ? (
          <div className="empty">Waiting for run events…</div>
        ) : (
          <ul className="feed">
            {[...frames]
              .sort((a, b) => b.seq - a.seq)
              .slice(0, 24)
              .map((frame) => (
                <li
                  key={frame.seq}
                  className={`feed-row feed-${frameTone(frame)}`}
                >
                  <span className="feed-event">{frame.event}</span>
                  <span className="feed-summary">{summarizeFrame(frame)}</span>
                  <span className="feed-seq">#{frame.seq}</span>
                </li>
              ))}
          </ul>
        )}
      </section>

      <footer className="footnote">
        aomi smither · {runs.length} run{runs.length === 1 ? "" : "s"} · gateway{" "}
        {workflowKey}
      </footer>
    </div>
  );
}

// --- styles (aomi tokens, self-contained) ----------------------------------

const STYLES = `
:root {
  --aomi-bg: #fafafa;
  --aomi-surface: #ffffff;
  --aomi-ink: #09090b;
  --aomi-muted: #71717a;
  --aomi-border: #e4e4e7;
  --aomi-accent: #d3c2d8;
  --aomi-accent-soft: #e3d8e6;
  --aomi-success: #2e9e6b;
  --aomi-warning: #d9982b;
  --aomi-danger: #d2495b;
  --aomi-info: #416cac;
  --aomi-font-display: "PT Serif", ui-serif, Georgia, serif;
  --aomi-font-body: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --aomi-font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--aomi-bg); color: var(--aomi-ink); font-family: var(--aomi-font-body); }
.page { max-width: 860px; margin: 0 auto; padding: 28px 20px 64px; }
.topbar { display: flex; align-items: center; justify-content: space-between; padding-bottom: 20px; }
.brand { display: flex; align-items: baseline; gap: 8px; }
.wordmark { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
.wordmark-sub { color: var(--aomi-muted); font-size: 15px; }
.gateway-status { display: flex; align-items: center; gap: 8px; color: var(--aomi-muted); font-size: 13px; }
.live { width: 8px; height: 8px; border-radius: 9999px; background: var(--aomi-muted); display: inline-block; }
.live-on { background: var(--aomi-success); box-shadow: 0 0 0 3px rgba(46,158,107,0.16); }
.hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin: 8px 0 20px; }
.eyebrow { text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; color: var(--aomi-muted); }
.package-title { font-family: var(--aomi-font-display); font-size: 40px; line-height: 1.1; margin: 4px 0 0; font-weight: 700; }
.hero-right { display: flex; align-items: center; gap: 10px; }
.pill { border: 1px solid; border-radius: 9999px; padding: 4px 12px; font-size: 12px; font-weight: 500; text-transform: lowercase; }
.run-select { font-family: var(--aomi-font-body); font-size: 13px; padding: 7px 12px; border-radius: 9999px; border: 1px solid var(--aomi-border); background: var(--aomi-surface); color: var(--aomi-ink); }
.summary-note { background: var(--aomi-accent-soft); border-radius: 12px; padding: 12px 16px; font-size: 14px; margin-bottom: 18px; }
.card { background: var(--aomi-surface); border: 1px solid var(--aomi-border); border-radius: 16px; padding: 18px 20px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(26,22,20,0.04); }
.card-title { font-size: 13px; font-weight: 500; color: var(--aomi-muted); margin-bottom: 12px; }
.stage-rail { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.stage-row { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 10px; border: 0; background: transparent; border-radius: 10px; cursor: pointer; text-align: left; font-family: inherit; font-size: 14px; color: var(--aomi-ink); }
.stage-row:hover { background: var(--aomi-bg); }
.stage-active { background: var(--aomi-accent-soft); }
.stage-label { flex: 1; }
.stage-status { font-size: 12px; text-transform: lowercase; }
.dot { width: 11px; height: 11px; border-radius: 9999px; border: 2px solid; flex-shrink: 0; }
.dot-pulse { animation: pulse 1.1s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
.approvals { margin-bottom: 16px; display: flex; flex-direction: column; gap: 10px; }
.approval-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; background: var(--aomi-surface); border: 1px solid var(--aomi-accent); border-left: 4px solid var(--aomi-warning); border-radius: 16px; padding: 16px 20px; }
.approval-title { font-family: var(--aomi-font-display); font-size: 18px; }
.approval-summary { color: var(--aomi-muted); font-size: 13px; margin-top: 4px; }
.approval-actions { display: flex; gap: 8px; flex-shrink: 0; }
.approval-clarify { border-left-color: var(--aomi-info); }
.clarify-options { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.btn { font-family: inherit; font-size: 14px; font-weight: 500; padding: 9px 18px; border-radius: 9999px; cursor: pointer; border: 1px solid transparent; }
.btn-primary { background: var(--aomi-ink); color: #fff; }
.btn-primary:hover { opacity: 0.9; }
.btn-ghost { background: transparent; color: var(--aomi-ink); border-color: var(--aomi-border); }
.btn-ghost:hover { background: var(--aomi-bg); }
.feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; font-size: 13px; }
.feed-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; }
.feed-event { font-family: var(--aomi-font-mono); font-size: 12px; }
.feed-summary { flex: 1; color: var(--aomi-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.feed-seq { color: var(--aomi-muted); font-family: var(--aomi-font-mono); font-size: 11px; }
.feed-error .feed-event { color: var(--aomi-danger); }
.feed-wait .feed-event { color: var(--aomi-warning); }
.feed-node .feed-event { color: var(--aomi-info); }
.code { background: #18181b; color: #e4e4e7; border-radius: 12px; padding: 14px 16px; overflow-x: auto; font-family: var(--aomi-font-mono); font-size: 12px; line-height: 1.5; margin: 0; }
.empty { color: var(--aomi-muted); font-size: 14px; padding: 6px 2px; }
.muted { color: var(--aomi-muted); }
.mono { font-family: var(--aomi-font-mono); font-size: 13px; }
.footnote { color: var(--aomi-muted); font-size: 12px; text-align: center; margin-top: 24px; }
`;

function injectHead() {
  if (typeof document === "undefined") return;
  const fonts = document.createElement("link");
  fonts.rel = "stylesheet";
  fonts.href =
    "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;700&family=Geist+Mono:wght@400;500&family=PT+Serif:wght@400;700&display=swap";
  document.head.appendChild(fonts);

  const style = document.createElement("style");
  style.textContent = STYLES;
  document.head.appendChild(style);
  document.title = `aomi smither · ${appName}`;
}

injectHead();
createGatewayReactRoot(<App />);
