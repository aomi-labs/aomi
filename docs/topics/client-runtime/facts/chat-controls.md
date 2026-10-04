---
title: Chat regeneration, editing, and cancellation
owner: frontend
status: active
sources_of_truth:
  - packages/client/src/session/index.ts
  - packages/client/src/session/conversation.ts
  - packages/react/src/runtime/message-actions.ts
  - scripts/test-chat-turn-controls.mjs
---

# Chat controls

Edit and Rerun work like a linear chat: they replace the conversation from a
user message onward and continue it with a normal turn, with the same app,
tools and signing rules as any other message. Edit sends the revised text with
`edit` set to the selected user's durable `message_key`. The widget's Rerun
sends the request before the selected answer unchanged, also with `edit`, so it
works for failed or stopped answers too. SDK callers may instead pass
`regenerate` with a completed answer's `message_key`; the server then reruns the
user message before it. The options are mutually exclusive. Threads are
linear, so the widget renders no branch picker.

The session echoes the new request at once and publishes the replaced user key
as `SessionSnapshot.pendingReplacesMessageKey`, so the runtime hides the
replaced message and everything after it before the server answers. The server
then records a durable `branch` event listing the removed message keys and turns,
followed by the new user message and the new answer. `SessionSnapshot.events`
keeps the full ledger for receipts and audit; `SessionSnapshot.messages` and
`projectConversationEvents` give the active conversation, also after reload.
Branch events from the first release kept the user message with replaced text;
the projection still reads them.

Stop publishes `isStopping` immediately and deduplicates concurrent requests.
The control stays an icon-only button and becomes disabled while streaming
continues until acknowledgement. `started_turn_id` identifies an accepted start.
Interrupt responses carry `terminal_turn` with the requested turn's actual
`complete`, `failed`, or `interrupted` outcome, independently of bounded event
pages. `stopped_turn_id` is present only for an interrupted turn. These
acknowledgements preserve the ordered cursor and do not fabricate ledger events.

An interrupted outcome freezes partial text and restores the composer. If
completion or failure wins the race with Stop, its answer and terminal status
remain intact, and a completed answer retains its Rerun identity. The client
drains remaining result pages and keeps scoped terminal acknowledgements until
durable history catches up. A rejected interruption keeps streaming available
and shows a retry message. Backend cancellation targets the requested provider
turn before runtime lock cleanup; transaction receipts remain durable.

Run `node scripts/test-chat-turn-controls.mjs` against a running local Portal,
using `LOCAL_PORTAL_URL` when its origin differs from `http://localhost:3000`.
When a complete Portal compilation exceeds a constrained cloud environment's
memory budget, `--harness` starts the source widget in a small Vite host. This
mounts the same `AomiFrame`, Thread, runtime, and SDK; its visible disclosure
identifies fixture data and the unverified Portal host integration.
The runner exercises desktop and mobile controls, partial HTTP SSE output,
repeated clicks, cancellation failure/retry, early Stop, reload persistence, and
Stop racing with completed or failed answers behind bounded history.
It writes screenshots and a JSON timing report to `/tmp/chat-controls-artifacts` (or
`CHAT_CONTROLS_ARTIFACTS`). Identity, REST responses, and model output are
synthetic fixtures; these results do not establish hosted authentication,
real model-provider latency, or on-chain execution.

Edit and Rerun scenarios also check that the replaced answer disappears within
400 ms of the click, before the fixture answers.

### Uncertain start admission

A lost start response retains the exact intent, idempotency key and funding lane.
The optional `SessionSnapshot.isStartUncertain` keeps Stop visible even when the
last known turn is terminal. Stop follows bounded canonical pages for possible
new activity, then replays that exact key to recover `started_turn_id`; it never
selects a turn by matching text or by choosing the latest processing event.
Exhausted history with no active work, or a missing session, releases the running
state and optimistic echo while retaining the original intent/key for a Send
retry. Terminal answers remain canonical and use the normal final-answer drain;
matching text never establishes admission ownership. No start is replayed solely
to cancel an idle request. Failed or stalled history reads retain uncertainty. Failed recovery
and failed interruption remain actionable; repeated Stop joins a single request
and targets the recovered identity until acknowledgment. Newer or unrelated runs
retain their state/stream. The guest backend resolves accepted/completed replay
before checking new-admission concurrency.
