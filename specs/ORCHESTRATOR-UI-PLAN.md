# Orchestrator UI Integration Plan

Status: PLANNED (2026-08-03). Decided UX is locked (see mock artifact and auto-memory
`orchestrator-trace-ui-decisions`): agent rows auto-expand while live, auto-fold to a
one-line summary when done (unless the user toggled them), "Orchestrating" header +
`orchestrator` badge, and the vertical rail under each agent row is load-bearing.
Mock reference: https://claude.ai/code/artifact/96148a25-4320-4138-928e-ed4a395c3e35

Two repos are involved:

- `product-mono/aomi` (Rust backend) — owns the orchestrator (`task` tool, child
  threads) and must start emitting delegation events. Today the parent transcript
  carries exactly one message per delegation, delivered after the child finishes.
- `aomi` (this repo) — client types, runtime projection, and the working-trace UI.

---

## 1. Entering orchestrator mode

**Decision: no new surface. The orchestrator is an app in the existing app selector.**

The backend already works this way — `AppSpec::orchestrator()` exists and the `task`
tool is registered under the `orchestrator-core` namespace; selecting any other app
returns `task_not_available`. The frontend already round-trips app selection:
`AppSelect` → `useControl().onAppSelect(id)` → `AomiClient.setModel` →
`POST /api/session/model`. `ThreadControlState.app` in the thread store is the
per-thread source of truth.

Work items (frontend only):

1. `apps/shadcn-registry/src/components/control-bar/app-metadata.ts`
   - Add an `orchestrator` entry to `APP_DISPLAY_NAMES`. Display name
     "Orchestrator", abbr "Or".
   - New category `{ id: "modes", label: "Modes", order: 5 }` so it sorts directly
     under the pinned "Basic Apps" row rather than being buried in DEX/CEX groups.
2. `apps/shadcn-registry/src/components/control-bar/app-select.tsx`
   - Give the orchestrator row the same two-line pinned treatment as "Basic Apps"
     (title + one-line description "Coordinate multiple agents on one task"),
     rendered above the category groups, separated by a `CommandSeparator`.
3. Control bar affordance: when `control.app === "orchestrator"`, the AppSelect
   trigger shows the orchestrator icon + name like any app — no extra chrome needed.
   The *trace* is where the mode is announced (§4).

Notes:
- The backend must include `orchestrator` in `GET /api/session/apps` descriptors for
  the account tiers that should see it. If it is to be gated (beta), gate it there —
  the selector renders only authorized apps, so no frontend flag is needed.
- Children cannot select the orchestrator app (`child_depth_exceeded` backend-side);
  no UI handling required.

---

## 2. Backend: the delegation event protocol (product-mono)

**Principle: emit everything on the MOTHER's event bus.** `ChildTaskService` already
holds `ParentTaskContext.event_bus` (currently unused) and its `drive()` loop polls
the child every 50 ms — it is the single place that sees the whole child lifecycle.
Emitting parent-bus events means the existing `GET /api/thread/updates` endpoint and
its one-thread filter need **no changes**, the existing SSE `Last-Event-ID` replay
covers mid-run reconnects, and child threads stay 409-firewalled.

New SSE events (all implement `SseEvent`, added in `crates/core/src/events/system.rs`,
emitted from `crates/runtime/src/child_task.rs` / `child_task/drive.rs`):

```jsonc
// when handle_task begins, before awaiting the child
{ "type": "task_started",
  "call_id": "…",                    // the task tool_call id
  "agent_id": "task-agent:9f2c…",
  "label": "swap-worker",            // from ChildTaskRequest.label
  "app": "default", "resumed": false }

// child activity, emitted by drive() as it observes the child transcript grow.
// kind "tool_call" for a child tool step; "note" for a completed chunk of the
// child's assistant text (drive() diffs child messages per poll tick — message-
// granular, not token streaming; fine for the UI's note rows).
{ "type": "task_activity",
  "call_id": "…", "agent_id": "…",
  "kind": "tool_call" | "note",
  "tool_name": "encode_and_simulate",  // kind=tool_call
  "args": { … }, "result_preview": "…",// truncated; reuse public redaction rules
  "text": "Quote locked — simulating…",// kind=note
  "child_seq": 7 }                      // monotonic per agent for dedupe/ordering

// terminal, emitted just before handle_task returns
{ "type": "task_completed",
  "call_id": "…", "agent_id": "…",
  "status": "completed" | "failed" | "stalled" | "cancelled",
  "message": "staged 1 swap, simulation passed", // see redaction note below
  "staged_count": 1, "steps": 4, "duration_ms": 12400 }
```

Redaction posture (decide once, here): `public_tool_return` currently strips the
child's return message down to `{agent_id, status, staged_count}`. The done-state
summary line needs prose. Recommendation: keep the *transcript* projection redacted
as-is, but carry `ChildTaskResult.message` (first ~200 chars) on `task_completed`,
and likewise pass child tool args/results through the same public-redaction rules
used for mother-thread tool transcripts. Nothing new becomes visible that the mother
transcript policy doesn't already allow for equivalent tools.

Explicit non-goals for this phase: no relaxation of the `is_task_child` 409 gates, no
`GET /api/thread/children`, no changes to `/api/thread/updates` filtering, no change
to mother-commit wallet flow (children stay compute-only per the v2 spec), no
parallel `task` dispatch (events are designed to interleave by `agent_id` so parallel
dispatch later requires no protocol change).

---

## 3. Client layer (`packages/client`)

1. `src/types.ts`
   - Extend `AomiMessage` with the fields Rust already serializes but TS never
     modeled: `tool_name?: string; tool_arguments?: unknown;`. (Needed to recognize
     completed `task` calls from the transcript on reload — Phase 0 below.)
   - Add `AomiTaskEvent` union for the three event payloads above; widen
     `AomiSSEEventType`.
2. `src/session/types.ts` — `SessionEventMap` gains:
   `task_started`, `task_activity`, `task_completed` (payload: `AomiTaskEvent`).
3. `src/session/events.ts` — route the three types like `tool_update` is routed
   today (re-emit on the session emitter; no session-state mutation in v1).
4. `src/sse.ts` — no changes (id-dedupe + reconnect already generic).
5. CLI parity (`src/cli/output.ts`, optional, cheap): on `task_started` print
   `◆ [agent] swap-worker started`; on `task_activity`/`task_completed` print
   indented `  ↳ …` lines in verbose mode. Keeps CLI and web narrating the same run.

---

## 4. React runtime projection (`packages/react`)

The live agent row cannot come from the transcript — the mother's `task` tool-call
message only exists *after* the child finishes. So live state is a sidecar keyed by
`agent_id`, joined to the transcript part when it lands.

1. `src/state/thread-store.ts` — per-thread `taskRuns: Record<agentId, TaskRunState>`:

```ts
export type TaskRunStep =
  | { kind: "tool_call"; toolName: string; args?: unknown; resultPreview?: string; childSeq: number }
  | { kind: "note"; text: string; childSeq: number };

export type TaskRunState = {
  agentId: string; callId: string; label: string; app: string | null;
  status: "running" | "completed" | "failed" | "stalled" | "cancelled";
  startedAt: number;                 // client clock at task_started
  steps: TaskRunStep[];             // ordered by childSeq, deduped
  message?: string; stagedCount?: number; durationMs?: number;
};
```

2. `src/runtime/orchestrator.ts` — subscribe to the three session events next to the
   existing `forwardEvent("tool_update")` calls; reduce into `taskRuns`. Dedupe on
   `(agentId, childSeq)` so SSE replay after reconnect is idempotent.
3. `src/runtime/utils.ts` (`toInboundMessage`) — when `msg.tool_name === "task"`,
   attach `metadata.custom.aomiTask = { agentId }` (parsed from the result JSON) to
   the tool-call part so the UI can join transcript ↔ sidecar.
4. `src/runtime/merge-turns.ts` — no structural change; `task` tool calls are
   ordinary tool-call parts in the merged turn. Verify re-keying preserves metadata.
5. Reconciliation rule (documented in code): while a `TaskRunState` is `running`,
   the trace renders it as a **synthetic agent row appended after the last
   transcript part**; once the transcript `task` part with the same `agentId`
   arrives, the synthetic row is dropped and the transcript part renders the row
   (done state) using the sidecar for steps/summary. On thread reload with no
   sidecar (older runs), the row renders from `tool_arguments` + result JSON alone —
   label, staged count, no steps ("Phase 0" degradation).

---

## 5. Working trace UI (`apps/shadcn-registry/.../assistant-ui/`)

All in `working-trace.tsx` (+ one new sibling file), reusing existing vocabulary:
`aui-*` class convention, `aomi-*` tokens only, mono type, chips via the existing
tool-interpreter (child tool calls are the same tool families — `interpretToolStep`
works unchanged on `TaskRunStep.tool_call`).

New component `WorkingAgent` (new file `working-agent.tsx`, class root
`aui-working-agent`):

- **Row header** (button): 16px marker slot — identity dot (7px, per-agent color:
  first agent `--aomi-accent`, second `--aomi-pink`, then cycle; pulses while
  running, becomes `CheckIcon`/`XIcon` on completion) · agent label
  (`font-mono text-[13px] font-medium`) · summary line (muted; hidden while
  expanded+live; shows `message` once done) · live counter
  (`N steps · Xs`, `font-mono text-xs tabular-nums`, 1 s tick) · chevron.
- **Subtree**: children rendered inside a rail —
  `margin-left: 7px; padding-left: 17px; border-left: 1px solid var(--aomi-border)`.
  **The rail is a hard requirement — it is the only marker of whose steps you're
  reading, and the thing that keeps interleaved parallel children legible.**
  `tool_call` steps reuse `WorkingStep` presentation (interpreted icon/title/chips,
  check on the previous step when a new one lands); `note` steps reuse
  `WorkingNote`.
- **Auto-expand / auto-fold** (the decided behavior):
  - Row mounts expanded (`data-open=true`) on `task_started`.
  - Any user click sets `userToggled` and the component never auto-changes state
    again for that row.
  - On terminal status, if `!userToggled`: wait ~900 ms (let the final check land),
    then fold to the one-line summary.
- **Single-live-signal rules** (extends the existing shimmer contract):
  - While an agent row is expanded and live: the newest child step shimmers; the
    mother's header label is plain.
  - While an agent row is collapsed and live: the row's summary slot shows the
    latest `note`/step title as a shimmering intent line.
  - The trace-level rule "collapse card mid-run → header shimmers" is unchanged.
- **Header mode**: in `WorkingTrace` header, when `turnPhase === "working"` and
  (`control.app === "orchestrator"` or any `taskRuns` entry is live for this turn):
  label "Orchestrating" instead of "Working"; add badge chip
  (`aui-working-badge`: mono 10px uppercase, `bg-aomi-accent-subtle
  text-aomi-accent-strong rounded-full px-2`). Done label "Orchestrated for Xs";
  badge repeats on the collapsed pill. Decide from turn data (presence of task
  parts/sidecar), not just current thread app, so scrollback renders correctly
  after the user switches apps.
- **Scroll window**: agent subtrees count toward the existing 260px
  `WORKING_WINDOW_PX` viewport; no special casing — newest-pinned behavior already
  handles a growing subtree.
- **Answer/pill**: unchanged. Step count in the header/pill counts top-level items
  plus child steps (matches the mocks: "9 steps").

Tool interpreter: add a `task` matcher to
`tool-interpreter/families/` so *Phase 0 / degraded* renders of the transcript part
get a sane title ("Delegated: swap-worker") + chips (`agent_id` short-hash, staged
count) instead of `humanize("task")`.

---

## 6. Phasing (each phase ships independently)

- **Phase 0 — no backend change.** Client models `tool_name`/`tool_arguments`;
  `task` interpreter family; `WorkingAgent` done-state rendered from transcript
  only (label + staged count, no steps); app selector entry. Value: orchestrator
  runs stop rendering as a bare `task` row; reload/scrollback story done first.
- **Phase 1 — lifecycle.** Backend emits `task_started`/`task_completed`.
  Live agent row with name + pulsing dot + elapsed; "Orchestrating" header; auto-fold
  on completion. No child steps yet — row body shows only the live elapsed counter.
- **Phase 2 — child activity.** `task_activity` (tool_call + note) from `drive()`;
  auto-expanded subtree streams under the rail; single-live-signal rules; CLI
  verbose lines. This is the full decided UX.
- **Phase 3 — polish / future.** Curated `message` copy, failure states
  (`stalled`/`cancelled` render `XIcon` + danger title), parallel children (protocol
  already interleaves by `agent_id`; UI already renders N rows), and optionally an
  expandable raw detail `<pre>` per child step (same as `WorkingStep` detail).

Testing per phase: unit-test the `taskRuns` reducer (replay/dedupe, reconnect
mid-run) in `packages/react`; projection tests for `toInboundMessage`/merge-turns
metadata survival; a fixture-driven storybook-style page for `WorkingAgent` states
(live-expanded, live-collapsed, done-folded, failed, two-agents-interleaved); extend
`test_orchestrator.rs` to assert the three events with correct `call_id`/ordering;
one CLI e2e asserting the verbose agent lines.

---

## 7. Open questions

1. **Backend gating of the app** — which account tiers see `orchestrator` in
   `GET /api/session/apps` at launch? (Frontend needs no flag either way.)
2. **`task_activity` payload size** — truncation budget for `args`/`result_preview`
   (proposal: 2 KB per event, tail-truncated with `…`).
3. **Stall UX** — `AOMI_TASK_STALL_TIMEOUT_SECS` is 300 s; does a stalled child fold
   to a danger row, or keep the row live with a "stalled, retrying" note?
4. **Note granularity** — message-granular notes are the plan; is sentence-level
   splitting worth it for long child monologues, or do we clamp note rows to
   ~2 lines with the existing edge-fade?
