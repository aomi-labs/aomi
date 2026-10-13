# SSE Connection Exhaustion — First Chat After Refresh Hangs

**Status:** Root cause confirmed. Fix not yet implemented (deferred by request).
**Date:** 2026-05-29

## Symptom

On the portal, after a page refresh, sending the first message on an existing
thread (or even a brand-new session) hangs — `POST /api/chat` never streams.
Clicking **New Chat** and sending sometimes works; using **Incognito or a
different browser** reliably works.

Frontend log shows the chat POST stuck:

```
[aomi][client] POST /api/chat prepared { sessionId: 'e3d08de3…', app: 'default', … }
[aomi][portal-fetch] start { fetchName: 'native.fetch', method: 'POST', url: '…/api/chat' }
[aomi][portal-fetch] still pending { …, pendingMs: 5001 }
```

DevTools → Network → Timing for the chat request: **"Stalled" ≈ 21.9 minutes.**

## Root cause

Browser **HTTP/1.1 connection-pool exhaustion** (~6 connections per origin).

The backend is served over plain HTTP on `127.0.0.1:8080` (HTTP/1.1, no
multiplexing). Every `ClientSession` opens a **long-lived, fetch-based SSE**
stream to `/api/updates` in its constructor:

- `packages/client/src/session.ts:421` — `this.unsubscribeSSE = this.client.subscribeSSE(...)`
- `packages/client/src/sse.ts:158` — `fetchImpl(`${backendUrl}/api/updates`, { signal })` held open via a `ReadableStream` reader.

One held connection **per open thread**. Idle threads aren't always reclaimed:
`SessionManager.closeIdleExcept` (`packages/react/src/runtime/session-manager.ts:53`)
**skips** any session that is processing, polling, or has pending wallet
requests — so background/long-polling sessions keep their SSE connection open
indefinitely. A wallet browser extension (observed `runtime.lastError` content-
script messaging failure) holds additional connections, pushing the profile over
the cap sooner.

Once the ~6-connection budget is consumed by held-open SSE streams, the next
request (`POST /api/chat`) cannot acquire a socket and sits in the browser's
queue ("Stalled") — which is why the **backend never logs an ingress line** for
it. Incognito / a fresh browser profile starts with an empty pool, so the chat
POST gets a socket immediately → "works."

### Ruled out during investigation
- **Session reconstruction** — repro happens on a brand-new session ("Created
  new session"); the slow rehydrate path never runs.
- **Backend session lock** — `/api/updates` uses a global broadcast channel
  (`product-mono aomi/bin/backend/src/endpoint/system.rs:93`); it does not hold
  the session `RwLock` for the stream lifetime.
- **x402 / payment fetch wrapper** — `routedFetch`
  (`apps/portal/src/components/portal-aomi-frame.tsx:181`) calls plain native
  `fetch` first and only retries with the payment transport after a `402`. The
  native fetch itself stalls, before any 402.

## Key insight for the fix

`/api/updates` is a **global broadcast** on the backend — it is NOT per-session.
So opening one SSE per `ClientSession` is both **redundant** and the direct cause
of pool exhaustion. The backend even documents the intent:

> `aomi/bin/backend/src/endpoint/system.rs:85` — "Alice: only talk to 1 SSE endpoint"

## Proposed fixes

### A. Single shared SSE (recommended, durable)
Hold **one** `/api/updates` connection for the whole client. Centralize the
subscription in `AomiClient` (or the orchestrator) instead of per-`ClientSession`,
and fan events out to the right thread by `session_id`. Removes the per-thread
connection cost entirely; helps every deployment, not just local dev.

Scope: `packages/client/src/session.ts` (stop subscribing per session),
`packages/client/src/sse.ts` / `client.ts` (single subscription, route by
session id), `packages/react/src/runtime/orchestrator.ts` (dispatch events to
the matching thread).

### B. Aggressively close idle SSE (smaller, partial)
Keep per-session SSE but tear down idle/background threads' connections even when
they're polling, and cap the number of concurrently open sessions. Lighter
change, but several genuinely-active threads can still approach the limit.

### C. HTTP/2 in dev (secondary / masking)
Serving the backend over HTTP/2 removes the 6-connection cap via multiplexing.
Awkward for plain-HTTP local dev and only masks the underlying redundancy.

**Recommendation:** A. B is acceptable as a stopgap. C only as an environment
tweak, not a real fix.

## Quick repro / confirmation
1. Normal browser profile with several threads visited → `POST /api/chat`
   Stalls for minutes; no backend ingress log.
2. Incognito / different browser → works immediately.
3. Network → Timing on the chat request shows the time in **Stalled**, not
   Waiting (TTFB).
