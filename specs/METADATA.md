# Project Metadata

## Packages

| Package | Purpose |
| --- | --- |
| `@aomi-labs/react` | React runtime provider, contexts, hooks, and public widget integration surface |
| `@aomi-labs/client` | `AomiClient`, `ClientSession`/`Session`, CLI, user-state types, wallet helpers, AA helpers |
| `@aomi-labs/auth` | Better Auth setup, SIWE/provider exchange, account graph helpers, provider wallet sync |
| `@aomi-labs/account` | Account bearer minting, service topology, shared same-origin backend proxy |
| `@aomi-labs/widget-lib` | Registry UI components and wallet-kit provider adapters |

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
| `@aomi-labs/client` | `AomiClient`, `Session` (`ClientSession`), `createAccountAccessTokenProvider`, CLI entrypoint |
| `@aomi-labs/auth/account` | account-service/provider-exchange helpers used by portal routes |
| `@aomi-labs/auth/better-auth` | Better Auth server and client setup |

## Directory Structure

```
packages/client/src/
├── client.ts                      # AomiClient HTTP/SSE transport
├── session.ts                     # ClientSession re-export
├── session/                       # ClientSession implementation and wallet controller
├── account-session.ts             # Optional BFF bearer provider for cross-origin clients
├── user-state/                    # UserState normalization and accessors
├── wallet-utils.ts                # Wallet request payload normalization
└── cli/                           # aomi CLI

packages/react/src/
├── index.ts                       # Public React package exports
├── interface.tsx                  # AomiRuntimeApi type and hooks
├── contexts/                      # User, event, thread, notification, control contexts
├── handlers/                      # useWalletHandler, useNotificationHandler
└── runtime/                       # React shell around AomiClient + ClientSession

packages/auth/src/
├── better-auth/                   # Better Auth config, SIWE, provider plugin, env
├── providers/                     # Privy/Para token verification and embedded-wallet listing
├── service/                       # account-service, provider-exchange, wallet-linking
└── db/                            # Auth/account graph schema and queries

packages/account/src/
├── bearer.ts                      # AccountBearer minting
├── proxy.ts                       # Same-origin backend proxy
├── session.ts                     # Better Auth session -> canonical user lookup
└── topology-data.ts               # trusted service public keys

apps/registry/src/lib/wallet-kit/  # Provider adapters, registry state, execution
apps/landing/                      # Demo Next.js app consuming built packages
apps/portal/                       # Portal app and auth/BFF routes
```

## Commands

```bash
pnpm install
pnpm run build:lib
pnpm --filter @aomi-labs/client build
pnpm --filter @aomi-labs/react build
pnpm --filter @aomi-labs/auth type-check
pnpm --filter landing dev
pnpm run dev:landing:live
pnpm run lint
```

## Environment

```
NEXT_PUBLIC_BACKEND_URL       # Browser backend base; "/" uses same-origin BFF proxy
NEXT_PUBLIC_PROJECT_ID        # Reown/WalletConnect project id for demos
BETTER_AUTH_SECRET            # Better Auth secret
BETTER_AUTH_URL               # Better Auth base URL
DATABASE_URL                  # Auth DB URL
PORTAL_SERVICE_PRIVATE_KEY    # Ed25519 service key used to mint AccountBearer
PRIVY_APP_ID                  # Privy app id for provider token verification
PRIVY_APP_SECRET              # Privy REST secret for embedded-wallet listing
PARA_API_KEY                  # Para REST key for embedded-wallet listing
```

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
