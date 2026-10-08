# Working Trace UI — Implementation Spec

**Audience:** an engineer implementing this end-to-end. Treat the "Styling contract"
and "Phase 3" sections as literal — copy the classes and structure exactly. If you
are unsure about a visual detail, prefer the option written here over your own taste.

**Goal:** Replace the current ugly stack of separate tool-call cards + text bubbles
with a single, modern **"Working" trace** (a collapsible chain-of-thought accordion
with a shimmer while active) that groups the model's intermediate talking + tool calls,
and reveals **only the final answer** as normal chat text.

---

## 0. TL;DR of the end state

One assistant turn currently renders as N separate bubbles/cards (talk, tool, talk,
tool, answer). We collapse everything **except the final answer** into one accordion:

```
WHILE THE MODEL IS WORKING                    AFTER IT FINISHES
┌───────────────────────────────────┐        ┌───────────────────────────────────┐
│ ◐  Working              0:03       │        │ ▸  Worked for 6s · 4 steps        │  ← collapsed, quiet
│ │  · Checking your balances        │        └───────────────────────────────────┘
│ │  ✓ Used get_balances        ▾    │        Here's the best route — swap 1 ETH
│ │  · Comparing routes across DEXs  │        → 3,412.80 USDC on Uniswap v3 …     ← final answer,
│ │  ◐ Used get_quote           ▾    │            (fast "stream-in" reveal)          normal markdown
└───────────────────────────────────┘
   ↑ header text shimmers; expanded          ↑ header stops shimmering, collapses,
     showing live steps                        final answer appears below it
```

**Two hard rules that drive the whole design:**

1. **The final answer never lives inside the trace.** While the turn is running there
   is _no_ final-answer element on screen at all — it is buffered. The instant the turn
   is confirmed finished, the final answer appears **below** the (now-collapsed) trace.
   Nothing ever moves between the trace and the answer region. No "pop in/out".
2. **The trace holds the model's intermediate talking (as muted step lines) + tool
   calls.** These stream in live. The final answer gets a fast "fake stream" reveal on
   completion (see Phase 3.5).

There are two mockups of this already produced in chat; this document is the source of
truth if they disagree.

---

## 1. Where things live (READ THIS — the obvious paths are wrong)

- **The live runtime is the `@aomi-labs/react` package at `packages/react/`.** The file
  `src/components/assistant-ui/runtime.tsx` at the repo root is **STALE DEAD CODE**
  (it imports `@/lib/conversion` and `@/lib/backend-api`, which no longer exist). Do
  **not** edit it. Delete it as part of Phase 1.
- `CLAUDE.md`'s "Key Files" section is also stale — ignore those paths.
- Message conversion: `packages/react/src/runtime/message-projection.ts` → `toInboundMessage()`.
- Runtime wiring / where converted messages get set into state:
  `packages/react/src/runtime/orchestrator.ts` → the `session.on("messages", …)` handler
  (around line 273).
- The canonical chat UI: `packages/widget/src/components/assistant-ui/`
  - `thread.tsx` — the Thread + `AssistantMessage` (this is what you rewire).
  - `tool-fallback.tsx` — current tool-call card (you replace its styling).
  - `markdown-text.tsx` — `MarkdownText` (reuse as-is for the final answer).
- Theme tokens + animations: `packages/widget/src/themes/default.css`.
- **Also check** `apps/portal/` and `apps/landing/` for their own copies of a Thread /
  assistant-message component. If they maintain duplicates, apply the same Phase 3
  change there. The Phase 1 + Phase 2 changes are in the shared package, so all apps
  inherit them automatically.

### How data flows today (so you know what you're working with)

The backend streams a flat `AomiMessage[]` (`packages/client/src/types.ts`):

```ts
interface AomiMessage {
  sender?: "user" | "agent" | "system" | string;
  content?: string; // a text chunk
  timestamp?: string;
  is_streaming?: boolean; // true while THIS text chunk is streaming
  tool_result?: [string, string] | null; // [toolName, resultJson] — a completed tool call
}
```

Each `AomiMessage` is **either** a text chunk **or** a completed tool result. Today
`toInboundMessage()` turns each one into its _own_ `ThreadMessageLike`, which is why a
single turn renders as a stack of separate bubbles/cards. **Phase 2 fixes this by
merging a turn into one message.**

Turn completion is known from `session.getIsProcessing()` (also surfaced via the
`processing_start` / `processing_end` events the orchestrator already listens to). No
backend change is required for any of this.

---

## 2. Styling contract (match the existing UI exactly)

This codebase uses **Tailwind v4** (`@theme inline` in `themes/default.css`) + shadcn
semantic tokens + `tw-animate-css`. Follow these conventions or it will look foreign.

### 2a. Class-name convention (IMPORTANT)

Every element in this codebase carries a **BEM-ish `aui-*` class first**, then Tailwind
utilities. Keep doing this — external theming hooks depend on it. Example from the repo:

```tsx
<div className="aui-tool-fallback-root mb-4 flex w-full flex-col gap-3 …">
```

So your new elements look like: `className="aui-working-trace-root …tailwind…"`.

### 2b. Use ONLY these semantic color tokens (never hardcoded colors)

| Token utility                                      | Meaning                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `text-foreground`                                  | primary text                                                        |
| `text-muted-foreground`                            | secondary / step text / meta                                        |
| `bg-background`                                    | page bg                                                             |
| `bg-muted` / `bg-muted/30` / `bg-muted/50`         | subtle fills (tool result blocks)                                   |
| `border` + `border-border/40` / `border-border/50` | hairline borders (use the /40–/50 opacity like the rest of the app) |
| `text-primary`                                     | links / accents                                                     |
| `bg-sidebar` `text-sidebar-foreground`             | inset notice cards                                                  |

Raw CSS vars (for gradients only): `var(--foreground)`, `var(--muted-foreground)`.

### 2c. Radii, text sizes, spacing

- Cards/containers: `rounded-2xl` (the app uses `rounded-2xl`/`3xl`/`4xl` for chat surfaces).
- Inner rows / small controls: `rounded-lg` / `rounded-xl`.
- Body text in messages is `text-sm leading-5` (note: `text-sm` = **0.8125rem** here, custom).
- Step/meta text: `text-xs` (= **0.6875rem** here) `text-muted-foreground`.
- Horizontal padding inside the message column matches siblings: `px-3`.

### 2d. Icons

`lucide-react` only (already a dep). Sizes: `size-4` inline, `size-3.5` for step markers,
`size-3` for tiny. Icons you'll need: `ChevronDownIcon`, `ChevronRightIcon`, `CheckIcon`,
`Loader2Icon` (spinner — add `animate-spin`), `WrenchIcon` (generic tool), `SparklesIcon`.

### 2e. Shimmer (already exists — do not reinvent)

`themes/default.css` already defines the keyframe `shimmer-sweep` and the theme animation
`--animate-shimmer` (usable as the utility `animate-shimmer`, speed via
`--shimmer-duration`). You will add ONE small class that clips it to text (Phase 3.1).

### 2f. Motion

`motion` v12 is installed (`motion/react`, `import * as m from "motion/react-m"`). The
Thread is already wrapped in `<LazyMotion features={domAnimation}>`, so `m.div` works
inside it. For expand/collapse you may use `tw-animate-css` utilities
(`animate-in fade-in slide-in-from-top-1 duration-150`) — the app already uses this exact
family (see `AssistantMessage` in `thread.tsx`). Prefer these utilities over hand-rolled
CSS transitions; they're simpler and on-brand.

### 2g. DON'Ts

- ❌ No new color values, gradients-as-decoration, drop shadows, or glows.
- ❌ No `display:none` toggling that hides streaming content — use conditional render.
- ❌ Don't add a per-step border card like the old `ToolFallback`. Steps are flat rows
  on a thin vertical rail (see Phase 3).
- ❌ Don't render the final answer while the turn is running (rule #1).

---

## 3. Implementation phases

Do them in order. Each phase is independently verifiable. **Use a fresh branch off
`main`** (do NOT build on the current `codex/merge-bff-betterauth` auth branch).

---

### Phase 1 — Upgrade `@assistant-ui/react` 0.11 → 0.14

We need `MessagePrimitive.GroupedParts` + `groupPartByType`, which only exist in
0.12.28+. Current install is 0.11.53/0.11.58; latest is 0.14.x.

**Bump these across every `package.json` in the workspace (consolidate the version drift
— today they range `^0.11.0`/`^0.11.28`/`^0.11.53`/`^0.11.58`):**

- `@assistant-ui/react` → `^0.14.23`
- `@assistant-ui/react-markdown` → `^0.14.4`
- `@assistant-ui/react-ai-sdk` → `^1.3.37` (first `grep -rn "react-ai-sdk" apps packages`
  — if nothing imports it, remove the dep instead of bumping it).

Then `pnpm install`.

**Breaking changes that actually touch our code (this is the complete list for our
surface — the rest of our imports are unaffected):**

1. **`useAssistantApi` and `useAssistantState` were REMOVED in 0.14.0.** Rename to
   `useAui` and `useAuiState`. Both are used in `packages/widget/.../thread.tsx`
   (`ThreadWelcome`, `ThreadLoadingSkeleton`, and the composer reset effect). Same
   selector signatures — it's a pure rename.
   - `const api = useAssistantApi()` → `const api = useAui()`
   - `useAssistantState(({ thread }) => …)` → `useAuiState(({ thread }) => …)`
2. **Verify `useMessage` still exists** (it is used all over `thread.tsx`). It was not
   flagged as removed. If it's gone in 0.14, replace `useMessage((s) => …)` with
   `useAuiState((s) => s.message…)` (same shape, message-scoped).
3. `ThreadPrimitive.ViewportSlack` and `fillClamp*` Viewport props were removed in 0.13 —
   **we don't use them**, no action.

**No breaking changes** to anything else we import: `useExternalStoreRuntime`,
`AssistantRuntimeProvider`, `ThreadMessageLike`, `AppendMessage`, `ExternalStoreThreadData`,
`ExternalStoreThreadListAdapter`, `ToolCallMessagePartComponent`, `makeAssistantToolUI`,
`ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`, `ActionBarPrimitive`,
`BranchPickerPrimitive`, `ErrorPrimitive`. (Sanity-check the external-store
`adapters.threadList` key still compiles.)

**Also:** delete the stale `src/components/assistant-ui/runtime.tsx`.

**Phase 1 gate (must pass before moving on):** `pnpm run build:lib`, typecheck, and run
each app (`pnpm --filter landing dev`, portal, widget) — the chat must work _exactly as
before_ (still the ugly stack — that's expected). This isolates upgrade risk.

---

### Phase 2 — Merge a turn into one message (data layer)

**File:** `packages/react/src/runtime/message-projection.ts` (+ its callsite in `orchestrator.ts`).

Today `toInboundMessage()` maps one `AomiMessage` → one `ThreadMessageLike`. Add a new
pass that folds a contiguous run of assistant messages (a "turn") into a **single**
assistant `ThreadMessageLike` whose `content` is an **ordered list of parts**, using the
part types the chain-of-thought grouping understands:

- interstitial talking → **`reasoning`** part `{ type: "reasoning", text }`
- a tool result → **`tool-call`** part
  `{ type: "tool-call", toolCallId, toolName, args: undefined, result }`
- the trailing/final answer text → **`text`** part `{ type: "text", text }`
  **— but only include this part once the turn is complete** (`!isProcessing`). While the
  turn is running, the trailing text is emitted as a `reasoning` part too (so it either
  becomes a step later, or gets promoted to the final `text` part on completion). This is
  what makes rule #1 automatic.

**Turn boundaries:** a turn is a maximal run of `sender === "agent"/"assistant"` messages
between `user`/`system` messages. `system` messages stay as-is (they're handled
elsewhere). Keep any message carrying special metadata (e.g. the `payment_required`
notice built in `orchestrator.ts`) as its **own** standalone message — do not fold it in.

**Metadata contract the UI depends on — set this on the merged message:**

```ts
metadata: {
  custom: {
    aomiTurn: {
      complete: boolean,        // = !isProcessing for the LAST turn; true for older turns
      startedAt?: number,       // ms epoch of the turn's first fragment (from its timestamp)
      completedAt?: number,     // ms epoch of the last fragment when complete
    }
  }
}
```

`isProcessing` is available at the callsite via `session.getIsProcessing()` — thread it
into the merge for the current (last) turn. `startedAt`/`completedAt` come from fragment
`timestamp`s; if timestamps are missing, omit them (the UI will just hide the elapsed
timer — that's fine).

**Suggested shape:**

```ts
export function mergeAssistantTurns(
  messages: ThreadMessageLike[],
  opts: { isProcessing: boolean },
): ThreadMessageLike[] {
  /* … */
}
```

Call it in `orchestrator.ts` right after the existing `toInboundMessage` mapping, before
`setThreadMessages`:

```ts
const converted = /* existing: msgs.map(toInboundMessage).filter(Boolean) */;
const merged = mergeAssistantTurns(converted, {
  isProcessing: session.getIsProcessing(),
});
threadContextRef.current.setThreadMessages(threadId, merged);
```

**Tests (required):** add to `packages/react/src/runtime/__tests__/`. Cover:

- talk → tool → talk → tool → answer folds into ONE assistant message with parts in order.
- while `isProcessing: true`, there is **no `text` part** (all talk is `reasoning`).
- on `isProcessing: false`, the trailing text is a single `text` part; earlier talk stays
  `reasoning`.
- user/system messages split turns correctly; `payment_required` stays standalone.
- `aomiTurn.complete` is correct per turn.

**Phase 2 gate:** with only Phase 2 done (Phase 3 not started), the existing
`MessagePrimitive.Parts` renderer will now show one message per turn instead of many.
It'll look a bit different but must not crash. Tests green.

---

### Phase 3 — The Working Trace UI (the visual work)

Two files: a **new** `working-trace.tsx`, and an edit to `AssistantMessage` in
`thread.tsx`. Plus one small CSS addition and a restyle of the tool row.

#### 3.0 Wire up grouping in `AssistantMessage` (`thread.tsx`)

Replace the normal-content `MessagePrimitive.Parts` block (the non-payment branch) with
`GroupedParts`. **Leave the `payment_required` branch and the empty/loading-dot logic
exactly as they are.**

```tsx
import { MessagePrimitive, groupPartByType } from "@assistant-ui/react";
import {
  WorkingTrace,
  WorkingReasoningStep,
  WorkingToolStep,
  FinalAnswer,
} from "@/components/assistant-ui/working-trace";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";

// …inside AssistantMessage, replacing the current <MessagePrimitive.Parts …/>:
<MessagePrimitive.GroupedParts
  groupBy={groupPartByType({
    reasoning: ["group-working"],
    "tool-call": ["group-working"],
  })}
>
  {({ part, children }) => {
    switch (part.type) {
      case "group-working":
        // reasoning + tool-call parts land here, in original order, as `children`
        return <WorkingTrace>{children}</WorkingTrace>;
      case "reasoning":
        return <WorkingReasoningStep text={part.text} />;
      case "tool-call":
        return (
          part.toolUI ?? (
            <WorkingToolStep
              toolName={part.toolName}
              argsText={part.argsText}
              result={part.result}
              status={part.status}
            />
          )
        );
      case "text":
        // the FINAL answer — only exists once the turn is complete (Phase 2)
        return (
          <FinalAnswer>
            <MarkdownText />
          </FinalAnswer>
        );
      default:
        return null;
    }
  }}
</MessagePrimitive.GroupedParts>;
```

Notes:

- `groupPartByType` groups **adjacent** parts of the listed types into a synthetic
  `group-working` part. Because Phase 2 emits all reasoning/tool parts contiguously
  before the final `text`, they form exactly one `group-working`; the `text` part is a
  different type and renders on its own, below the group. That's rule #1 for free.
- `MarkdownText` reads the current part from context (same as today's usage), so calling
  it inside the `text` case works — do not pass it props.
- Keep `MessageError` and the footer/action bar exactly as they are.

#### 3.1 One CSS addition — `themes/default.css`

Add, right after the existing `--animate-shimmer` block (reuses their `shimmer-sweep`
keyframe):

```css
/* Working-trace: shimmer clipped to the header text */
.aui-working-shimmer {
  background: linear-gradient(
    90deg,
    var(--muted-foreground) 0%,
    var(--foreground) 20%,
    var(--muted-foreground) 40%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: shimmer-sweep var(--shimmer-duration, 1600ms) linear infinite;
}

/* Working-trace: fast "stream-in" reveal for the final answer (markdown-safe) */
.aui-working-final-reveal {
  -webkit-mask-image: linear-gradient(
    to bottom,
    #000 0%,
    #000 45%,
    transparent 80%
  );
  mask-image: linear-gradient(to bottom, #000 0%, #000 45%, transparent 80%);
  -webkit-mask-size: 100% 300%;
  mask-size: 100% 300%;
  -webkit-mask-position: 0 100%;
  mask-position: 0 100%;
  animation: aui-final-reveal 420ms ease-out forwards;
}
@keyframes aui-final-reveal {
  to {
    -webkit-mask-position: 0 0;
    mask-position: 0 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .aui-working-shimmer {
    animation: none;
    color: var(--muted-foreground);
    -webkit-text-fill-color: currentColor;
  }
  .aui-working-final-reveal {
    animation: none;
    -webkit-mask-image: none;
    mask-image: none;
  }
}
```

#### 3.2 `working-trace.tsx` — the accordion container

**File:** `packages/widget/src/thread/working-trace.tsx`

Behavior:

- Reads the merged message's `metadata.custom.aomiTurn` for `complete` + timing.
- **While `!complete`:** expanded, header shows a spinner + shimmering "Working" +
  elapsed timer (mm:ss, ticking). Not user-collapsible (or allow it — but default open).
- **On `complete`:** auto-collapse once to a quiet summary line
  `▸ Worked for {Ns} · {N} steps`, which the user can click to re-expand. Header stops
  shimmering; spinner → nothing.
- Left vertical **rail** connecting the step markers (a 1px line). Steps are `children`.

```tsx
"use client";

import {
  type PropsWithChildren,
  useEffect,
  useRef,
  useState,
  Children,
} from "react";
import { ChevronDownIcon, ChevronRightIcon, Loader2Icon } from "lucide-react";
import { cn, useAuiState } from "@aomi-labs/react"; // if useAuiState isn't re-exported from here, import from "@assistant-ui/react"

type AomiTurn = {
  complete?: boolean;
  startedAt?: number;
  completedAt?: number;
};

export function WorkingTrace({ children }: PropsWithChildren) {
  const turn = useAuiState(
    (s: any) => s.message?.metadata?.custom?.aomiTurn as AomiTurn | undefined,
  );
  const complete = turn?.complete ?? true;
  const stepCount = Children.toArray(children).length;

  // Collapse exactly once, when the turn transitions to complete.
  const [collapsed, setCollapsed] = useState(false);
  const wasComplete = useRef(false);
  useEffect(() => {
    if (complete && !wasComplete.current) setCollapsed(true);
    wasComplete.current = complete;
  }, [complete]);

  const elapsedS = useElapsedSeconds(turn, complete);

  return (
    <div className="aui-working-trace-root mb-3 mt-1">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="aui-working-trace-header flex w-full items-center gap-2 text-left"
        aria-expanded={!collapsed}
      >
        <span className="aui-working-trace-caret text-muted-foreground/70">
          {collapsed ? (
            <ChevronRightIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          )}
        </span>
        {!complete && (
          <Loader2Icon className="aui-working-trace-spinner text-muted-foreground size-3.5 animate-spin" />
        )}
        {!complete ? (
          <span className="aui-working-shimmer text-sm font-medium">
            Working
          </span>
        ) : (
          <span className="aui-working-trace-summary text-muted-foreground text-sm">
            Worked{elapsedS != null ? ` for ${elapsedS}s` : ""}
            <span className="text-muted-foreground/60">
              {" "}
              · {stepCount} step{stepCount === 1 ? "" : "s"}
            </span>
          </span>
        )}
        {!complete && elapsedS != null && (
          <span className="aui-working-trace-elapsed text-muted-foreground/60 ml-auto text-xs tabular-nums">
            {fmt(elapsedS)}
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="aui-working-trace-steps animate-in fade-in slide-in-from-top-1 relative mt-2 pl-[7px] duration-150">
          {/* vertical rail */}
          <div className="aui-working-trace-rail bg-border/60 pointer-events-none absolute bottom-2 left-[7px] top-1.5 w-px" />
          <div className="flex flex-col gap-0.5">{children}</div>
        </div>
      )}
    </div>
  );
}

function fmt(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function useElapsedSeconds(
  turn: AomiTurn | undefined,
  complete: boolean,
): number | null {
  const started = turn?.startedAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (complete || started == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [complete, started]);
  if (started == null) return null;
  const end = complete ? (turn?.completedAt ?? started) : now;
  return Math.max(0, Math.round((end - started) / 1000));
}
```

> If `useAuiState` is not re-exported from `@aomi-labs/react`, import it from
> `@assistant-ui/react`. The selector path `s.message.metadata.custom.aomiTurn` matches
> the metadata Phase 2 writes. Typed as `any` in the selector is acceptable here.

#### 3.3 `WorkingReasoningStep` — an interstitial "talking" line

A flat row: a small dot marker on the rail + muted text. **No card, no border.**

```tsx
export function WorkingReasoningStep({ text }: { text: string }) {
  if (!text?.trim()) return null;
  return (
    <div className="aui-working-step relative grid grid-cols-[14px_1fr] items-start gap-2.5 py-1">
      <span className="aui-working-step-marker bg-muted-foreground/40 mt-[5px] size-1.5 justify-self-center rounded-full" />
      <span className="aui-working-step-text text-muted-foreground text-xs leading-5">
        {text}
      </span>
    </div>
  );
}
```

#### 3.4 `WorkingToolStep` — a tool call as a step (replaces the old card)

A flat row: status marker (check when done, spinner when running) + `Used {toolName}` +
a chevron to expand the raw result. Expanded result reuses the muted mono block styling.
This replaces `tool-fallback.tsx`'s bordered card — either put it in `working-trace.tsx`
or restyle `tool-fallback.tsx` and import it.

```tsx
import { useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Loader2Icon,
  WrenchIcon,
} from "lucide-react";

type ToolStatus = { type?: "running" | "complete" | string } | undefined;

export function WorkingToolStep({
  toolName,
  argsText,
  result,
  status,
}: {
  toolName: string;
  argsText?: string;
  result?: unknown;
  status?: ToolStatus;
}) {
  const [open, setOpen] = useState(false);
  const running = status?.type === "running";

  return (
    <div className="aui-working-tool relative grid grid-cols-[14px_1fr] items-start gap-2.5 py-1">
      <span className="aui-working-tool-marker bg-background text-muted-foreground mt-[3px] flex size-3.5 items-center justify-center justify-self-center rounded-full">
        {running ? (
          <Loader2Icon className="size-3 animate-spin" />
        ) : (
          <CheckIcon className="size-3" />
        )}
      </span>

      <div className="aui-working-tool-body min-w-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="aui-working-tool-header text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 text-left text-xs"
          aria-expanded={open}
        >
          <WrenchIcon className="text-muted-foreground/60 size-3 shrink-0" />
          <span className="truncate">
            Used{" "}
            <span className="text-foreground/80 font-medium">{toolName}</span>
          </span>
          <span className="text-muted-foreground/50 ml-auto shrink-0">
            {open ? (
              <ChevronUpIcon className="size-3" />
            ) : (
              <ChevronDownIcon className="size-3" />
            )}
          </span>
        </button>

        {open && (
          <div className="aui-working-tool-detail animate-in fade-in border-border/50 bg-muted/30 mt-1.5 flex flex-col gap-1.5 rounded-lg border p-2.5 duration-100">
            {argsText && (
              <pre className="aui-working-tool-args text-muted-foreground whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
                {argsText}
              </pre>
            )}
            {result !== undefined && (
              <pre className="aui-working-tool-result text-muted-foreground whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
                {typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

> In v1, tool parts always arrive already-complete (the backend only sends `tool_result`
> when done), so the marker is normally a check. The `running` branch is there for
> Phase 4. Do not block on wiring live running state now.

#### 3.5 `FinalAnswer` — the fast fake-stream reveal

Wraps the final markdown. On mount (which only happens once the turn is complete, per
Phase 2) it plays the ~420ms top-to-bottom mask "stream-in". Runs once; respects reduced
motion (the CSS handles that).

```tsx
export function FinalAnswer({ children }: PropsWithChildren) {
  return (
    <div className="aui-working-final text-foreground break-words px-0 text-sm leading-5">
      <div className="aui-working-final-reveal">{children}</div>
    </div>
  );
}
```

> Why a CSS mask sweep and not a JS typewriter: a character/word typewriter would have to
> re-parse markdown on every tick (tables, lists, bold) and causes layout reflow. The
> mask sweep reveals the fully-rendered markdown top-to-bottom, reads as "streaming in",
> is ~420ms fast, and is markdown-safe. **Do not implement a JS typewriter over markdown.**

#### 3.6 Empty / loading state (leave mostly intact)

The existing `AssistantMessage` shows a pulsing `AssistantLoadingDot` when the message is
empty + running + last. Keep that: before any reasoning/tool part arrives, the merged
message is empty → the dot shows. Once the first step arrives, `WorkingTrace` renders.
No change needed beyond wiring `GroupedParts`.

---

### Phase 4 — Polish / follow-ups (not required for v1)

- **Live per-tool running status:** the orchestrator already forwards `tool_update` /
  `tool_complete` SSE events (see `orchestrator.ts` `forwardEvent(...)`). Feed these into
  the active tool step so it shows a spinner while a tool is mid-flight, then flips to a
  check. This is the only piece that makes the `running` marker light up before the
  result lands.
- Friendly tool labels + icons (map known `toolName`s → human label + lucide icon, with
  the generic `Used {toolName}` fallback). v1 ships generic.
- Fine-tune shimmer speed (`--shimmer-duration`) and reveal duration to taste.

---

## 4. Acceptance criteria (manual QA checklist)

Run the widget (`packages/widget`) and a real agent turn with tool calls:

- [ ] A turn with tools renders as **one** "Working" accordion, not a stack of cards.
- [ ] While running: header text **shimmers**, a spinner shows, elapsed ticks, steps
      (talking lines + tool rows) appear live on a vertical rail.
- [ ] **No final answer is visible while running.** (Rule #1.)
- [ ] When the turn finishes: the trace **auto-collapses** to `▸ Worked for Ns · N steps`,
      shimmer stops, and the final answer appears **below** it with a quick top-to-bottom
      stream-in reveal. Nothing jumps between the trace and the answer.
- [ ] Clicking the collapsed header re-expands the steps; clicking a tool row expands its
      raw args/result in a muted mono block.
- [ ] A **plain reply with no tools** shows **no trace** — just the answer (because there
      are no reasoning/tool parts to group; the single `text` part renders alone).
- [ ] Copy / reload action bar and branch picker still work (one per turn now).
- [ ] `payment_required` notice still renders as its own card, unchanged.
- [ ] Dark mode: every color uses tokens and looks right.
- [ ] `prefers-reduced-motion`: no shimmer, no reveal animation, content just shows.
- [ ] Landing + portal chat still work (shared package change propagated).

## 5. Gotchas

- The final answer's part **must not exist during streaming** — that's enforced in Phase 2
  (merge), not in the UI. If you see the answer flicker inside the trace and pop out,
  Phase 2 is emitting a `text` part too early.
- `groupPartByType` groups **adjacent** parts. If reasoning/tool parts aren't contiguous
  (e.g. Phase 2 accidentally interleaves the final `text` between them), you'll get
  multiple `group-working` blocks. Keep the final `text` strictly last.
- Don't forget the `aui-*` class prefix on every element.
- After Phase 1, if `useMessage` disappeared, migrate it (see Phase 1 note 2) — the whole
  `thread.tsx` depends on it.
- When done, update `specs/STATE.md` per this repo's convention.
