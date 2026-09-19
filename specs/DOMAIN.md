# Domain Rules

## Architecture

**Single Sources of Truth:**

- User/wallet state -> `packages/react/src/contexts/ext-user-context.tsx` plus `UserState` from `@aomi-labs/client`
- Thread state -> `packages/react/src/contexts/thread-context.tsx`
- Backend transport -> `packages/client/src/client.ts` (`AomiClient`)
- Per-thread runtime state -> `packages/client/src/session/index.ts` (`ClientSession`, exported as `Session`)
- React session orchestration -> `packages/react/src/runtime/orchestrator.ts` and `session-manager.ts`
- Event dispatching -> `ClientSession` events bridged into `packages/react/src/contexts/event-context.tsx`
- Control state (model/app/api key) -> `packages/react/src/contexts/control-context.tsx`
- Message conversion -> `packages/react/src/runtime/utils.ts`

**Provider Hierarchy:**

```
AomiRuntimeProvider
└── ThreadContextProvider
    └── NotificationContextProvider
        └── ExtUserProvider
            └── ControlContextProvider
                └── EventContextProvider
                    └── AomiRuntimeCore
                        └── RuntimeUserStateProvider
                            └── AomiRuntimeApiProvider
                                └── AssistantRuntimeProvider
                                    └── {children}
```

**Component Hierarchy:**

```
AomiFrame (apps/registry)
├── ThreadListSidebar (navigation)
├── Thread (message view)
├── ControlBar (model/app/API-key selection)
└── Wallet kit providers (Para, Privy, Base Account, or host-provided)
```

## Do / Don't

| Do | Don't |
| --- | --- |
| Use `AomiClient` from `@aomi-labs/client` for backend calls | Recreate HTTP helpers inside `@aomi-labs/react` |
| Use `ClientSession`/`Session` for per-thread polling, SSE, and wallet requests | Reintroduce React-side polling/message controllers |
| Use `useUser()`/`UserState` for wallet state | Keep local wallet state in frame components |
| Let the wallet kit sync identity into `UserState` | Manually post wallet state from UI controls |
| Let the same-origin BFF proxy mint backend bearers from Better Auth | Send browser cookies or user-provided `Authorization` upstream |

## File Conventions

| Location | Purpose |
| --- | --- |
| `packages/client/src/client.ts` | `AomiClient` HTTP/SSE transport |
| `packages/client/src/session/` | `ClientSession` runtime state machine and wallet-request controller |
| `packages/client/src/account-session.ts` | Optional client-side BFF bearer provider for cross-origin calls |
| `packages/react/src/contexts/*.tsx` | React state providers (user, thread, event, notification, control) |
| `packages/react/src/runtime/*.tsx` | React integration around `AomiClient`/`ClientSession` |
| `packages/react/src/handlers/*.ts` | Wallet and notification handler hooks |
| `apps/registry/src/lib/wallet-kit/` | Host wallet/provider adapters and runtime user sync |
| `packages/account/src/proxy.ts` | Same-origin BFF proxy that strips browser auth and injects trusted backend bearer |
| `packages/auth/src/` | Better Auth setup, provider exchange, account graph, wallet linking |

## Key Types

| Type | Source |
| --- | --- |
| `AomiClient`, `AomiClientOptions` | `@aomi-labs/client` (`packages/client/src/client.ts`) |
| `Session` / `ClientSession`, `SessionOptions` | `@aomi-labs/client` (`packages/client/src/session/`) |
| `UserState`, `WalletRequest`, `WalletRequestResult` | `@aomi-labs/client` |
| `AomiRuntimeProvider`, `AomiRuntimeApi` | `@aomi-labs/react` |
| `ControlState`, `ControlContextApi` | `packages/react/src/contexts/control-context.tsx` |
| `AomiWalletKit`, provider adapters | `apps/registry/src/lib/wallet-kit/` |

## Data Flows

**User message:**

```
Composer -> AomiRuntimeCore -> useRuntimeOrchestrator
  -> ClientSession.send()/sendAsync()
  -> AomiClient.sendMessage() -> POST /api/chat
  -> ClientSession polls GET /api/state and listens to GET /api/updates
  -> React thread store updates
```

**Thread switch:**

```
Thread list click -> threadContext.setCurrentThreadId()
  -> ensureInitialState()
  -> ClientSession.fetchState() / AomiClient.fetchState()
  -> messages, title, processing state applied to thread store
```

**Wallet state change:**

```
Wallet provider adapter -> AomiWalletKitSync
  -> useUser().setUser(UserState)
  -> ClientSession sends normalized user_state on chat/state requests
```

**Inbound wallet request:**

```
Backend -> /api/state or /api/updates system event
  -> ClientSession wallet controller
  -> orchestrator event bridge
  -> useWalletHandler callback
  -> ClientSession.resolve()/reject()
```

**Same-origin backend auth:**

```
Browser -> /api/* same-origin request with Better Auth cookie
  -> packages/account proxy resolves better-auth.session_token
  -> proxy mints short-lived AccountBearer with sub = canonical Aomi user id
  -> backend receives Authorization: Bearer <AccountBearer>
```

**Cross-origin backend auth:**

```
createAccountAccessTokenProvider()
  -> GET /v1/account/bearer using Better Auth cookie
  -> optional provider exchange through /api/auth/aomi/provider/exchange
  -> AomiClient attaches Authorization when talking directly to backend
```

## Backend Endpoints

| Endpoint | Purpose | Client surface |
| --- | --- | --- |
| `POST /api/chat` | Send message | `AomiClient.sendMessage` |
| `GET /api/state` | Fetch session state | `AomiClient.fetchState`, `ClientSession` |
| `POST /api/interrupt` | Cancel generation | `AomiClient.interrupt` |
| `POST /api/system` | Send system event | `AomiClient.sendSystemMessage` |
| `GET /api/updates` | SSE stream | `AomiClient.subscribeSSE`, `ClientSession` |
| `POST /api/sessions` | Create thread/session | `AomiClient.createThread` |
| `GET /api/sessions` | List threads | `AomiClient.listThreads` |
| `GET /api/sessions/:id` | Get thread | `AomiClient.getThread` |
| `PATCH /api/sessions/:id` | Rename thread | `AomiClient.renameThread` |
| `DELETE /api/sessions/:id` | Delete thread | `AomiClient.deleteThread` |
| `GET /api/session/apps` | List app descriptors | `AomiClient.getApps` |
| `GET /api/session/models` | List models | `AomiClient.getModels` |
| `POST /api/session/model` | Set model/app for session | `AomiClient.setModel` |
| `GET /api/account` | Current account profile | `AomiClient.getAccount` |
| `GET /v1/account/bearer` | Mint AccountBearer from Better Auth session | `createAccountAccessTokenProvider` |
| `POST /api/auth/aomi/provider/exchange` | Create Better Auth session from provider token | Better Auth Aomi provider plugin |
| `POST /v1/account/provider/exchange` | Link provider token into existing Better Auth session | Portal route + `@aomi-labs/auth` |

Archive/unarchive helpers still exist on `AomiClient` for API compatibility, but the current backend does not expose `/api/sessions/:id/archive` or `/api/sessions/:id/unarchive`.

## Invariants

1. `AomiRuntimeProvider` constructs exactly one `AomiClient` per backend/options identity.
2. `ClientSession` owns polling, SSE subscription, message state, processing state, and wallet requests for one thread.
3. `@aomi-labs/react` re-exports client types but does not own the transport implementation.
4. The real browser/device cookie is `better-auth.session_token`.
5. The backend never receives browser cookies; the BFF proxy strips `cookie` and incoming `Authorization`.
6. Backend `AccountBearer.sub` is the canonical Aomi user id.
7. Provider-attested embedded wallets are synced only after server-side provider verification; the deferred schema/provenance FK work remains separate.
8. Active wallet per family is owned by `apps/registry/src/lib/wallet-kit/registry/store.ts`.
9. Model selection is backend-session state, not global React-only state.
10. All browser API consumers must remain client components.
