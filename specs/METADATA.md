# Project Metadata

## Packages

| Package | Purpose |
| --- | --- |
| `@aomi-labs/react` | React runtime provider, contexts, hooks, and public widget integration surface |
| `@aomi-labs/client` | `AomiClient`, `ClientSession`/`Session`, user-state types, wallet helpers, AA helpers |
| `@aomi-labs/cli` | The `aomi` terminal command |
| `@aomi-labs/account` | Account graph, Better Auth, SIWE/provider exchange, bearer minting, service topology, same-origin backend proxy |
| `@aomi-labs/widget` | Chat UI and wallet provider adapters |

## Stack

- React 19 / Next.js 15 / TypeScript
- `@assistant-ui/react` for chat primitives
- Radix UI + Tailwind CSS 4 for styling
- Better Auth for browser/device sessions
- `tsup` for publishable package bundles

## Package Entrypoints

| Package | Main exports |
| --- | --- |
| `@aomi-labs/react` | `AomiRuntimeProvider`, runtime hooks, handlers, re-exported `AomiClient`/client types |
| `@aomi-labs/client` | `AomiClient`, `Session` (`ClientSession`), `createAccountAccessTokenProvider`. The `aomi` bin forwards to `@aomi-labs/cli` |
| `@aomi-labs/cli` | `aomi` terminal command |
| `@aomi-labs/account` | Bearer minting, backend proxy, `./account`, `./better-auth`, `./providers` |

## Directory Structure

```
packages/client/src/
├── client.ts                      # AomiClient HTTP/SSE transport
├── session.ts                     # ClientSession re-export
├── session/                       # ClientSession implementation and wallet controller
├── account-session.ts             # Optional BFF bearer provider for cross-origin clients
├── user-state/                    # UserState normalization and accessors
└── wallet-utils.ts                # Wallet request payload normalization

packages/cli/src/                  # aomi terminal command

packages/react/src/
├── index.ts                       # Public React package exports
├── interface.tsx                  # AomiRuntimeApi type and hooks
├── contexts/                      # User, event, thread, notification, control contexts
├── handlers/                      # useWalletHandler, useNotificationHandler
└── runtime/                       # React shell around AomiClient + ClientSession

packages/account/src/
├── bearer.ts                      # AccountBearer minting
├── proxy.ts                       # Same-origin backend proxy
├── better-auth/                   # Better Auth config, SIWE, provider plugin, env
├── providers/                     # Privy/Para token verification and embedded-wallet listing
├── service/                       # account graph, provider exchange, wallet linking
├── db/                            # Account graph schema and queries
└── topology-data.ts               # trusted service public keys

packages/widget/src/wallet/        # Wallet provider adapters
apps/landing/                      # Demo Next.js app consuming built packages
apps/portal/                       # Portal app and auth/BFF routes
```

## Commands

```bash
pnpm install
pnpm run build:packages
pnpm --filter @aomi-labs/client build
pnpm --filter @aomi-labs/react build
pnpm --filter @aomi-labs/account type-check
pnpm --filter landing dev
pnpm run dev:landing:live
pnpm run lint
```

## Environment

Each app lists its real secrets and per-environment values in one example
file: `apps/portal/.env.example`, `apps/build/.env.example`,
`apps/landing/.env.example` and `apps/edge/.dev.vars.example`. The rules are in
AGENTS.md under "Secrets and env vars".

The real Better Auth browser cookie is `better-auth.session_token`.

## Ports

- 3000: Landing/demo app
- 3001: Portal app in local auth-stack flows
- 8080: Backend API

## Build Output Policy

`packages/react` and `packages/client` both publish from `dist/`, and their `package.json` exports point at `dist` files. The repo currently tracks those build artifacts and has no install-time build hook, so the committed policy is to keep `dist/` checked in until the package/export convention changes deliberately.

## Key Client Types

```typescript
type AomiClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  apiKey?: string;
  getAccountAccessToken?: GetAccountAccessToken;
  logger?: { debug: (...args: unknown[]) => void };
};

class AomiClient {
  fetchState(sessionId: string, userState?: UserState, clientId?: string): Promise<AomiStateResponse>;
  sendMessage(sessionId: string, message: string, options?: SendOptions): Promise<AomiChatResponse>;
  subscribeSSE(sessionId: string, onUpdate: (event: AomiSSEEvent) => void): () => void;
  listThreads(sessionId: string): Promise<AomiThread[]>;
  createThread(threadId: string): Promise<AomiCreateThreadResponse>;
  getApps(sessionId: string): Promise<AomiAppDescriptor[]>;
  getModels(sessionId: string): Promise<string[]>;
  setModel(sessionId: string, rig: string, options?: SetModelOptions): Promise<SetModelResponse>;
}

class ClientSession {
  constructor(clientOrOptions: AomiClient | AomiClientOptions, sessionOptions?: SessionOptions);
  send(message: string): Promise<SendResult>;
  sendAsync(message: string): Promise<AomiChatResponse>;
  resolve(requestId: string, result: WalletRequestResult): Promise<void>;
  reject(requestId: string, reason?: string): Promise<void>;
  close(): void;
}
```

## Backend API Endpoints

```
POST   /api/chat
GET    /api/state
POST   /api/interrupt
POST   /api/system
GET    /api/updates
POST   /api/sessions
GET    /api/sessions
GET    /api/sessions/:id
PATCH  /api/sessions/:id
DELETE /api/sessions/:id
GET    /api/session/apps
GET    /api/session/models
POST   /api/session/model?rig=X&app=Y
GET    /api/account
GET    /v1/account/bearer
POST   /api/auth/aomi/provider/exchange
POST   /v1/account/provider/exchange
```

All backend session/thread endpoints carry `X-Session-Id`. Same-origin browser calls rely on the BFF proxy to translate the Better Auth cookie into a backend `AccountBearer`; direct cross-origin calls can opt into `createAccountAccessTokenProvider`.
