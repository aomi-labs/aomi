# Runtime Architecture

This document explains how the Aomi runtime system works, including component structure, state management, and message flow.

## Overview

The runtime is built on `@assistant-ui/react`'s external store pattern. It bridges React UI components with a backend chat API through a layered architecture of controllers and state managers.

---

## Component Structure

```mermaid
graph TB
    subgraph "Provider Layer"
        TCP[ThreadContextProvider]
        ARP[AomiRuntimeProvider shell]
        NCP[NotificationContextProvider]
        UCP[ExtUserProvider]
        ECP[EventContextProvider]
        RAP[RuntimeActionsProvider]
        ARC[AomiRuntimeCore]
        ASRP[AssistantRuntimeProvider]
    end

    subgraph "Controllers"
        RO[RuntimeOrchestrator]
        MC[MessageController]
        PC[PollingController]
    end

    subgraph "State"
        BS[BackendState]
        TS[ThreadStore]
        EB[EventBuffer]
    end

    subgraph "Handler Hooks"
        WH[useWalletHandler]
        NH[useNotificationHandler]
    end

    subgraph "External"
        API[AomiClient]
        BE[Backend Server]
    end

    TCP --> ARP
    ARP --> NCP
    NCP --> UCP
    UCP --> ECP
    ECP --> RAP
    RAP --> ARC
    ARC --> ASRP

    ARC --> RO
    RO --> MC
    RO --> PC
    RO --> BS

    MC --> API
    PC --> API
    API --> BE

    ECP --> EB
    ECP --> API

    WH --> ECP
    NH --> ECP

    ARC --> TS
    MC --> TS
```

---

## State Architecture

```mermaid
graph LR
    subgraph "ThreadContext (React State)"
        CTI[currentThreadId]
        TM[threadMetadata<br/>Map&lt;id, metadata&gt;]
        THR[threads<br/>Map&lt;id, messages&gt;]
        TC[threadCnt]
        TVK[threadViewKey]
    end

    subgraph "BackendState (Mutable Ref)"
        TTB[tempToBackendId<br/>Map&lt;temp, backend&gt;]
        SIF[skipInitialFetch<br/>Set&lt;id&gt;]
        PCH[pendingChat<br/>Map&lt;id, texts&gt;]
        PSY[pendingSystem<br/>Map&lt;id, texts&gt;]
        RT[runningThreads<br/>Set&lt;id&gt;]
        CTD[creatingThreadId]
        CTP[createThreadPromise]
    end

    subgraph "EventBuffer (Mutable Ref)"
        IBQ[inboundQueue<br/>Event array]
        OBQ[outboundQueue<br/>Event array]
        SSS[sseStatus<br/>connected or disconnected]
        LID[lastEventId<br/>string]
    end

    CTI --> TTB
    THR --> PCH
    IBQ -.->|notifications| THR
    OBQ -.->|wallet events| TTB
```

### State Responsibilities

| State           | Purpose                       | Reactivity                     |
| --------------- | ----------------------------- | ------------------------------ |
| `ThreadContext` | UI-facing thread/message data | Reactive (triggers re-renders) |
| `BackendState`  | Backend sync coordination     | Non-reactive (mutable ref)     |
| `EventBuffer`   | Inbound/outbound event queues | Non-reactive (mutable ref)     |

---

## Message Flow - Outbound (User Sends Message)

```mermaid
sequenceDiagram
    participant UI as User Interface
    participant RT as Runtime
    participant MC as MessageController
    participant BS as BackendState
    participant TC as ThreadContext
    participant API as AomiClient
    participant PC as PollingController
    participant BE as Backend

    UI->>RT: onNew(message)
    RT->>MC: outbound(message, threadId)

    MC->>TC: Add optimistic user message
    MC->>TC: Update lastActiveAt

    alt Thread not ready (temp ID, no backend mapping)
        MC->>BS: enqueuePendingChat(threadId, text)
        MC->>BS: setThreadRunning(true)
        Note over MC: Wait for thread creation
    else Thread ready
        MC->>BS: setThreadRunning(true)
        MC->>API: postChatMessage(backendId, text)
        API->>BE: POST /chat
        BE-->>API: Response
        MC->>MC: flushPendingSystem()
        MC->>PC: start(threadId)
    end
```

---

## Message Flow - Inbound (Polling for Response)

```mermaid
sequenceDiagram
    participant PC as PollingController
    participant API as AomiClient
    participant BE as Backend
    participant MC as MessageController
    participant BS as BackendState
    participant TC as ThreadContext
    participant UI as User Interface

    loop Every 500ms while processing
        PC->>API: fetchState(backendId)
        API->>BE: GET /api/state
        BE-->>API: {messages, is_processing}
        API-->>PC: SessionResponsePayload

        Note over PC: applySessionState compares incoming<br/>messages to session._messages
        alt Messages unchanged from last tick
            Note over PC,UI: Skip setMessages + emit("messages").<br/>No React re-render this tick.
        else Messages changed
            PC->>MC: applyMessages(threadId, messages)
            MC->>TC: setThreadMessages(threadId, converted)
            TC->>UI: Re-render with new messages
        end

        alt is_processing = false
            PC->>PC: stop(threadId)
            PC->>BS: setThreadRunning(false)
            Note over UI: Assistant response complete
        end
    end
```

---

## Thread Creation Flow

```mermaid
sequenceDiagram
    participant UI as Thread List
    participant TLA as ThreadListAdapter
    participant BS as BackendState
    participant TC as ThreadContext
    participant API as AomiClient
    participant BE as Backend
    participant MC as MessageController

    UI->>TLA: onSwitchToNewThread()

    alt Existing pending thread
        TLA->>TLA: preparePendingThread(existingId)
        TLA->>TC: Switch to pending thread
    else No pending thread
        TLA->>TLA: Generate temp-{uuid}
        TLA->>BS: Set creatingThreadId
        TLA->>TC: Create metadata (status: pending)
        TLA->>TC: setCurrentThreadId(tempId)

        TLA->>API: createThread(publicKey)
        API->>BE: POST /threads
        BE-->>API: {session_id, title}

        TLA->>BS: setBackendMapping(tempId, backendId)
        TLA->>BS: markSkipInitialFetch(tempId)
        TLA->>TC: Update metadata with backend title

        alt Has pending chat messages
            loop For each pending message
                TLA->>API: postChatMessage(backendId, text)
            end
            TLA->>MC: Start polling
        end
    end
```

---

## Thread Switch Flow

```mermaid
sequenceDiagram
    participant UI as User Interface
    participant TLA as ThreadListAdapter
    participant TC as ThreadContext
    participant ARC as AomiRuntimeCore
    participant SM as SessionManager
    participant RO as RuntimeOrchestrator
    participant API as AomiClient

    UI->>TLA: onSwitchToThread(threadId)
    TLA->>TC: setCurrentThreadId(threadId)

    Note over ARC: useEffect on currentThreadId
    ARC->>SM: closeIdleSessionsExcept(threadId)
    Note right of SM: Closes idle non-active sessions.<br/>Sessions still processing / polling /<br/>with pending wallet requests are kept warm.

    alt Local-only thread (not in remoteThreadIds)
        ARC->>ARC: setIsThreadLoading(false)
        Note over ARC: Nothing to fetch, no skeleton.
    else Cached revisit (messages already in ThreadContext)
        Note over ARC: Skeleton stays off — cached messages render instantly.
        ARC->>RO: ensureInitialState(threadId)
        RO->>SM: get(threadId)
        alt Session survived (still processing / polling)
            RO->>RO: sync isRunning + pending requests from session
        else No session (was idle, closed)
            Note over RO: Skip recreate — would reopen SSE for no reason.<br/>Session lazily recreates on next sendMessage.
            RO->>RO: setIsRunning(false)
        end
    else Cold remote thread
        ARC->>ARC: setIsThreadLoading(true) — skeleton on
        par Run in parallel
            ARC->>API: warmThread → POST /api/sessions (no-op if already warmed)
        and
            ARC->>RO: ensureInitialState(threadId)
            RO->>SM: getSession(threadId) — opens SSE for active thread
            RO->>API: GET /api/state
            API-->>RO: {messages, is_processing}
            RO->>TC: setThreadMessages(threadId, converted)
        end
        ARC->>ARC: setIsThreadLoading(false) — skeleton off
    end
```

See [Performance Optimizations](#performance-optimizations) for the rationale behind the cached-revisit branch and the parallel cold path.

---

## Event Flow - Inbound Notification (SSE)

```mermaid
sequenceDiagram
    participant BE as Backend Server
    participant API as AomiClient
    participant ECP as EventContextProvider
    participant EB as EventBuffer
    participant NH as useNotificationHandler
    participant UI as Notification Component

    Note over BE: System triggers notification
    BE->>API: SSE push: {type: notification, session_id, title, body}
    API->>ECP: subscribeSSE callback
    ECP->>EB: enqueueInbound(event)
    ECP->>EB: dispatch(event)

    Note over EB: Dispatch to subscribers

    EB->>NH: subscriber callback(event)
    NH->>NH: Build Notification object
    NH->>NH: setNotifications([...prev, notification])
    NH->>NH: onNotification?.(notification)
    NH-->>UI: notifications array updated
    UI->>UI: Render notification toast/panel
```

---

## Event Handler Architecture

```mermaid
graph TB
    subgraph "Application Layer"
        WC[Wallet Component]
        NC[Notification Component]
    end

    subgraph "Handler Hooks"
        WH[useWalletHandler]
        NH[useNotificationHandler]
    end

    subgraph "Event Context"
        EC[useEventContext]
        SUB[subscribe fn]
        ENQ[enqueueOutbound fn]
    end

    subgraph "Event Buffer State"
        IBQ[inboundQueue]
        OBQ[outboundQueue]
        SUBS[subscribers Map]
    end

    subgraph "Backend Integration"
        API[AomiClient]
        SSE[SSE Connection]
        POST[POST /events]
    end

    WC --> WH
    NC --> NH

    WH --> EC
    NH --> EC

    EC --> SUB
    EC --> ENQ

    SUB --> SUBS
    ENQ --> OBQ

    SSE --> IBQ
    IBQ --> SUBS
    SUBS -.->|dispatch| NH
    SUBS -.->|dispatch| WH

    OBQ --> POST
    POST --> API
```

---

## Event Flow - Outbound Wallet Event

```mermaid
sequenceDiagram
    participant Wallet as Wallet Provider
    participant WC as Wallet Component
    participant WH as useWalletHandler
    participant EC as useEventContext
    participant EB as EventBuffer
    participant ECP as EventContextProvider
    participant API as AomiClient
    participant BE as Backend Server

    Note over Wallet: Transaction completes
    Wallet-->>WC: onTransactionConfirmed(tx)
    WC->>WH: sendTxComplete({txHash, status, amount, token})

    WH->>EC: enqueueOutbound({<br/>  type: wallet:tx_complete,<br/>  sessionId, payload, priority: high<br/>})
    EC->>EB: outboundQueue.push(event)

    Note over EB: Buffer stores event

    alt priority = high (immediate flush)
        EC->>EB: drainOutbound()
        EB-->>EC: events[]
        EC->>API: POST /events [events]
    else priority = normal (batched)
        Note over ECP: Flush timer (1s interval)
        ECP->>EB: hasHighPriorityOutbound()
        ECP->>EB: drainOutbound()
        EB-->>ECP: events[]
        ECP->>API: POST /events [events]
    end

    API->>BE: Store/process events
    BE-->>API: 200 OK
```

---

## Wallet Handler - Full Flow

```mermaid
sequenceDiagram
    participant AppKit as External Wallet<br/>(AppKit/wagmi)
    participant WC as Wallet Component
    participant WH as useWalletHandler
    participant EC as useEventContext
    participant EB as EventBuffer
    participant BE as Backend

    Note over AppKit: Wallet connects
    AppKit-->>WC: onConnect(address, chainId)
    WC->>WH: sendConnectionChange("connected", address)
    WH->>EC: enqueueOutbound({type: wallet:connected, ...})
    EC->>EB: push to outboundQueue
    EB-->>BE: POST /events

    Note over BE: AI requests transaction
    BE->>API: HTTP api/state: {"system": {"type": "wallet_tx_request",}}
    EB->>WH: subscriber callback
    WH->>WH: setPendingTxRequests([...prev, request])
    WH->>WC: onTxRequest?.(request)
    WC->>WC: Show tx confirmation UI

    Note over WC: User approves transaction
    WC->>AppKit: sendTransaction(tx)
    AppKit-->>WC: txHash

    WC->>WH: sendTxComplete({txHash, status: success})
    WH->>EC: enqueueOutbound({type: wallet:tx_complete, priority: high})
    EC->>EB: immediate flush (high priority)
    EB-->>BE: POST /events

    WC->>WH: clearTxRequest(index)
    WH->>WH: Remove from pendingTxRequests
```

---

## Notification Handler - Full Flow

```mermaid
sequenceDiagram
    participant BE as Backend
    participant API as AomiClient
    participant ECP as EventContextProvider
    participant EB as EventBuffer
    participant NH as useNotificationHandler
    participant NC as Notification Component
    participant User as User

    Note over BE: Backend sends notification
    BE->>API: SSE: {type: notification, session_id, title, body}
    API->>ECP: subscribeSSE callback(event)
    ECP->>EB: enqueueInbound(event)
    ECP->>EB: dispatch(event) to subscribers

    EB->>NH: subscriber("notification", callback)
    NH->>NH: Build Notification {id, type, title, body, handled: false}
    NH->>NH: setNotifications([notification, ...prev])
    NH->>NC: onNotification?.(notification)

    NC->>NC: Render notification badge/toast
    NC->>NC: Show unhandledCount

    Note over User: User clicks notification
    User->>NC: Click to view
    NC->>NH: markHandled(id)
    NH->>NH: Update notification.handled = true
    NH->>NC: unhandledCount decremented
```

---

## SSE Connection Lifecycle

```mermaid
sequenceDiagram
    participant RO as RuntimeOrchestrator
    participant EC as EventController
    participant SSE as BackendSSE
    participant EB as EventBuffer
    participant BE as Backend Server

    Note over RO: Runtime mounts
    RO->>EC: initialize()
    EC->>SSE: connect(publicKey, lastEventId)
    SSE->>BE: EventSource(/events/subscribe)
    BE-->>SSE: Connection established
    SSE->>EC: onConnected()
    EC->>EB: sseStatus = connected

    loop While connected
        BE-->>SSE: event: ping
        SSE->>SSE: Reset timeout
    end

    alt Connection lost
        BE--xSSE: Connection dropped
        SSE->>EC: onDisconnected()
        EC->>EB: sseStatus = disconnected

        loop Exponential backoff (1s, 2s, 4s...)
            SSE->>BE: Reconnect attempt
            alt Success
                BE-->>SSE: Connected
                SSE->>EC: onConnected()
                EC->>EB: sseStatus = connected
            else Fail
                SSE->>SSE: Increase backoff
            end
        end
    end

    Note over RO: Runtime unmounts
    RO->>EC: cleanup()
    EC->>SSE: disconnect()
    EC->>EB: flush remaining outbound
```

---

## Key Components

### AomiRuntimeProvider (shell)

Provider shell component (`runtime/aomi-runtime.tsx`, ~50 lines) that:

- Creates `AomiClient` instance from `backendUrl`
- Composes context providers: Notification → User → Event → RuntimeActions
- Renders `AomiRuntimeCore` with shared `aomiClient`

### AomiRuntimeCore

Inner component (`runtime/core.tsx`) that:

- Uses `useUser()` for wallet state, auto-syncs changes to backend
- Uses `useEventContext()` for system event dispatching
- Initializes runtime orchestrator with `getPublicKey` callback
- Connects to `@assistant-ui/react` via `useExternalStoreRuntime`
- Manages thread list via `buildThreadListAdapter()`
- Subscribes to SSE title updates

### RuntimeOrchestrator

Hook that creates and coordinates:

- `BackendState` ref
- `MessageController` instance (with `getPublicKey` callback)
- `PollingController` instance (with `onSystemEvents` callback)
- `ensureInitialState()` for loading thread data on switch

### MessageController

Handles all message operations:

- `outbound()` - Send user messages
- `outboundSystem()` - Send system messages
- `inbound()` - Process messages from backend
- `flushPendingChat()` / `flushPendingSystem()` - Send queued messages
- `cancel()` - Interrupt processing

### PollingController

Manages backend polling:

- `start(threadId)` - Begin polling at 500ms intervals
- `stop(threadId)` - Stop polling for a thread
- `stopAll()` - Stop all active polls
- Auto-stops when `is_processing` becomes false

### EventContextProvider

React context that manages the EventBuffer and SSE connection:

- Subscribes to AomiClient SSE events on mount
- Dispatches inbound events to registered subscribers
- Provides `subscribe(type, callback)` for handler hooks
- Provides `enqueueOutbound(event)` for sending events
- Flushes outbound queue on timer (1s) or immediately for high priority
- Exposes `sseStatus` for connection state

### useWalletHandler

Hook for wallet integration:

- `sendTxComplete(tx)` - Report transaction completion to backend
- `sendConnectionChange(status, address)` - Report wallet connect/disconnect
- `pendingTxRequests` - Array of pending AI-requested transactions
- `clearTxRequest(index)` - Remove handled request from queue
- Subscribes to `wallet:tx_request` events from backend

### useNotificationHandler

Hook for notification display:

- `notifications` - Array of all received notifications
- `unhandledCount` - Count of unread notifications
- `markHandled(id)` - Mark notification as read
- `onNotification` - Optional callback when new notification arrives
- Subscribes to `notification` events from backend

### BackendSSE

SSE client for real-time server events:

- Maintains persistent connection to `/events/subscribe`
- Parses SSE event types (notification, title_changed, etc.)
- Forwards events to EventController for buffering
- Supports `lastEventId` for resuming missed events

### EventBuffer

Non-reactive state for event streaming:

| Field           | Type    | Purpose                  |
| --------------- | ------- | ------------------------ |
| `inboundQueue`  | Event[] | Buffered events from SSE |
| `outboundQueue` | Event[] | Buffered events to send  |
| `sseStatus`     | string  | Connection status        |
| `lastEventId`   | string  | For SSE resume           |

### BackendState

Non-reactive state for backend coordination:

| Field                 | Type    | Purpose                                    |
| --------------------- | ------- | ------------------------------------------ |
| `tempToBackendId`     | Map     | Maps temporary UI IDs to real backend IDs  |
| `skipInitialFetch`    | Set     | Threads that shouldn't fetch on switch     |
| `pendingChat`         | Map     | User messages queued before thread ready   |
| `pendingSystem`       | Map     | System messages queued before user message |
| `runningThreads`      | Set     | Threads currently processing               |
| `creatingThreadId`    | string  | Thread being created                       |
| `createThreadPromise` | Promise | Active thread creation promise             |

### ThreadContext

Reactive state for UI:

| Field             | Type   | Purpose                                |
| ----------------- | ------ | -------------------------------------- |
| `currentThreadId` | string | Active thread                          |
| `threadMetadata`  | Map    | Title, status, lastActiveAt per thread |
| `threads`         | Map    | Messages per thread                    |
| `threadCnt`       | number | Counter for "Chat N" naming            |
| `threadViewKey`   | number | Force re-render key                    |

---

## ID Resolution

The runtime uses temporary IDs (`temp-{uuid}`) for optimistic UI during thread creation:

```mermaid
graph LR
    subgraph "Before Backend Response"
        T1[temp-abc123] --> UI1[UI renders immediately]
    end

    subgraph "After Backend Response"
        T2[temp-abc123] --> MAP[tempToBackendId]
        MAP --> B1[backend-xyz789]
        B1 --> API[All API calls]
    end
```

The `resolveThreadId()` function always checks `tempToBackendId` first, allowing the UI to work with stable IDs while the backend uses its own IDs.

---

## Performance Optimizations

The runtime applies several optimizations to avoid wasted BE round-trips and React re-renders on common interactions. Each item below names the file and observable network/render effect.

### Thread switch — cached revisit (zero BE work)

When the user switches back to a thread whose messages are already in `ThreadContext`, the runtime:

1. Suppresses the loading skeleton — cached messages render instantly. ([core.tsx](packages/react/src/runtime/core.tsx) — `setIsThreadLoading(true)` is gated on `hasCachedMessages === false`.)
2. Skips the `/api/state` fetch in `ensureInitialState`. ([orchestrator.ts](packages/react/src/runtime/orchestrator.ts) — cache-hit branch when `cachedMessages.length > 0 || hydratedThreadIds.has(threadId)`.)
3. Does not recreate the `ClientSession` if `closeIdleSessionsExcept` tore it down. That would reopen a fresh `/api/updates` SSE connection for no reason. The session lazily recreates inside `sendMessage` when the user actually does something.

Observable effect on revisit clicks to idle threads: **no `/api/state`, no `/api/updates`, no skeleton flash, no React commit.**

### Thread switch — cold path (parallel warm + fetch)

`warmThread` (idempotent `POST /api/sessions`) and `ensureInitialState` (`GET /api/state`) run concurrently via `Promise.all`. The skeleton-off transition is gated on whichever finishes last; in practice `/api/state` dominates and warm completes inside its window. ([core.tsx](packages/react/src/runtime/core.tsx))

### Polling — unchanged-state short-circuit

`applySessionState` shallow-compares incoming `state.messages` against the session's current `_messages` (per-field check on `sender`, `content`, `timestamp`, `is_streaming`, `tool_result`). When the BE poll returns identical state — common while waiting for the LLM to start producing tokens — the runtime skips both `setMessages` and the `"messages"` emit, avoiding a 2 Hz full-thread re-render. ([session/events.ts](packages/client/src/session/events.ts) — `aomiMessagesEqual`.)

### Session keep-warm

`closeIdleSessionsExcept` only closes sessions that are **not** processing, **not** polling, and have **no** pending wallet requests. A thread that's mid-generation when the user navigates away keeps its `ClientSession` (and its SSE connection) alive; on revisit, the existing session is reused — no SSE reopen, no state refetch. ([session-manager.ts](packages/react/src/runtime/session-manager.ts))

### Auth-scoped fetches (mount-only)

`fetchApps` (`GET /api/session/apps`) and `fetchModels` (`GET /api/session/models`) in `ControlContextProvider` are scoped to mount + `state.apiKey` changes — **not** to thread switches. The effect deps use `getCurrentControlSessionId`, a stable `useCallback(() => …, [])` that reads from refs. Without this discipline, switching threads would trigger `/api/session/apps` (~3 s BE cost on production) on every click. ([control-context.tsx](packages/react/src/contexts/control-context.tsx))

---

## Cleanup

On unmount, the runtime:

1. Calls `polling.stopAll()` to clear all intervals
2. Calls `eventController.cleanup()` to close SSE and flush outbound
3. React handles cleanup of refs and state

On thread delete:

1. Removes from `threadMetadata` and `threads`
2. Clears all backend state entries for that thread
3. Switches to another thread or creates a default
