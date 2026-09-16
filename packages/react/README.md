# @aomi-labs/react

React runtime, hooks, and utilities for building UIs on top of the Aomi on-chain agent backend.

## Install

```bash
npm install @aomi-labs/react @assistant-ui/react react react-dom
# or
pnpm add @aomi-labs/react @assistant-ui/react react react-dom
```

Optional dependencies when wiring wallet UI through Para + wagmi:

```bash
pnpm add wagmi viem
```

If you use the registry-installed `AomiFrame` from `@aomi-labs/widget-lib`,
wallet behavior comes from the surrounding Para + wagmi provider tree.
`@aomi-labs/react` does not ship built-in wallet providers.

## Quick Start

Wrap your app with `AomiRuntimeProvider`, then use `useAomiRuntime()` anywhere inside:

```tsx
import { AomiRuntimeProvider, useAomiRuntime } from "@aomi-labs/react";

function App() {
  return (
    <AomiRuntimeProvider backendUrl="https://api.aomi.dev">
      <Chat />
    </AomiRuntimeProvider>
  );
}

function Chat() {
  const { sendMessage, isSubmitting, turnState, events } = useAomiRuntime();

  return (
    <div>
      <button onClick={() => sendMessage("What's the price of ETH?")}>
        Ask
      </button>
      {(isSubmitting || turnState === "processing") && <p>Thinking...</p>}
      <p>{events.length} ordered events</p>
    </div>
  );
}
```

## Provider

### `<AomiRuntimeProvider>`

Root provider that composes thread selection, notifications, the client-owned
`UserState` source, controls, and the runtime core. Each active thread owns one
`ClientSession` external store; React only selects and projects its snapshot.

| Prop         | Default                   | Description      |
| ------------ | ------------------------- | ---------------- |
| `backendUrl` | `"http://localhost:8080"` | Aomi backend URL |
| `children`   | —                         | React children   |

## Hooks

### `useAomiRuntime()`

Unified hook providing access to all runtime APIs. Must be used inside `<AomiRuntimeProvider>`.

Returns an `AomiRuntimeApi` object with:

**User API**

| Property                | Description                                      |
| ----------------------- | ------------------------------------------------ |
| `user`                  | Current user state (wallet address, chain, etc.) |
| `setUser(data)`         | Update user state (partial merge)                |
| `getUserState()`        | Read the current canonical UserState             |

**Thread API**

| Property                  | Description                |
| ------------------------- | -------------------------- |
| `currentThreadId`         | Active thread ID           |
| `threadMetadata`          | Map of all thread metadata |
| `createThread()`          | Create a new thread        |
| `deleteThread(id)`        | Delete a thread            |
| `renameThread(id, title)` | Rename a thread            |
| `selectThread(id)`        | Switch to a thread         |

**Agent API**

| Property                 | Description                     |
| ------------------------ | ------------------------------- |
| `isSubmitting`           | Before the first backend Event exists          |
| `isRunning`              | Derived from authoritative `TurnState`         |
| `events`                 | Ordered canonical Events for the active session|
| `turnState`              | Backend-owned lifecycle                        |
| `getMessages(threadId?)` | Assistant UI projection of `MessageEvent`s     |
| `sendMessage(text)`      | Submit a typed StartTurn Intent                 |
| `cancelGeneration()`     | Submit a typed Interrupt Intent                |

**Action API**

| Property                           | Description               |
| ---------------------------------- | ------------------------- |
| `pendingActions`              | Durable Actions awaiting a response |
| `actionAttempts`              | Execution attempts from ClientSession |
| `executeAction(id)`           | Execute through canonical capabilities |
| `respondToAction(id, result)` | Submit a typed ActionResult Intent |
| `rejectAction(id, reason?)`   | Reject a pending Action |

### Other Hooks

| Hook                       | Description                                               |
| -------------------------- | --------------------------------------------------------- |
| `useUser()`                | User/wallet state context                                 |
| `useThreadContext()`       | Thread management context                                 |
| `useControl()`             | Model/namespace/API key state                             |
| `useNotification()`        | Toast notification context                                |
| `useActions(session)`      | Thin Action/attempt selector over a ClientSession snapshot |

## Utilities

```ts
import {
  cn, // clsx + tailwind-merge
  formatAddress, // 0x1234...5678
  getNetworkName, // chainId → "Ethereum", "Polygon", etc.
  getChainInfo, // chainId → { name, symbol, explorer }
  SUPPORTED_CHAINS, // supported chain info map
} from "@aomi-labs/react";
```

## Re-exports

`AomiClient` and all core types are re-exported from `@aomi-labs/client`:

```ts
import { AomiClient } from "@aomi-labs/react";
import type { Event, MessageEvent, Action, TurnState } from "@aomi-labs/react";
```
