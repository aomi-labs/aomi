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

Rerun sends `regenerate` with the selected completed assistant's durable
`message_key`. The server resolves its original user request and preceding
context, including the original request behind a delayed transaction callback.
Edit sends the revised text with `edit` set to the selected user's durable key.
The two options are mutually exclusive. Neither control inserts an implementation
prompt or an optimistic extra user row.

Both operations create a durable `branch` event. Its replacement text and
removed message/turn identities determine the active conversation after reload.
`SessionSnapshot.events` retains the original ledger for transaction outcomes
and audit; `SessionSnapshot.messages` and `projectConversationEvents` provide
the active conversation. The selected user keeps its key and display position
and becomes associated with the new run. Superseded traces and delayed callback
events cannot become active again. The backend disables tools during branch
generation so signed or completed actions are not repeated.

Stop publishes `isStopping` immediately and deduplicates concurrent requests.
The control stays an icon-only button and becomes disabled while streaming continues until
acknowledgement. `started_turn_id` and `stopped_turn_id` identify accepted starts
and stops independently of bounded event pages, preserving the ordered cursor.
An acknowledged Stop freezes partial text and restores the composer. A failure
keeps streaming available and shows a retry message. Backend cancellation
signals the provider before runtime lock cleanup; transaction receipts remain
durable.

Run `node scripts/test-chat-turn-controls.mjs` against a running local Portal,
using `LOCAL_PORTAL_URL` when its origin differs from `http://localhost:3000`.
When a complete Portal compilation exceeds a constrained cloud environment's
memory budget, `--harness` starts the source widget in a small Vite host. This
mounts the same `AomiFrame`, Thread, runtime, and SDK; its visible disclosure
identifies fixture data and the unverified Portal host integration.
The runner exercises desktop and mobile controls, partial HTTP SSE output,
repeated clicks, cancellation failure/retry, early Stop, and reload persistence.
It writes screenshots and a JSON timing report to `artifacts/issue-696` (or
`CHAT_CONTROLS_ARTIFACTS`). Identity, REST responses, and model output are
synthetic fixtures; these results do not establish hosted authentication,
real model-provider latency, or on-chain execution.

The paired backend change is
[product-mono#1232](https://github.com/aomi-labs/product-mono/pull/1232).
Frontend and backend must support the branch event and acknowledgment fields
together for the complete behavior, including history pagination and reload.
