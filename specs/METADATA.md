# Project Metadata

## Packages

| Package | Purpose |
| --- | --- |
| `@aomi-labs/react` | React runtime provider, contexts, hooks, and public widget integration surface |
| `@aomi-labs/client` | `AomiClient`, `ClientSession`/`Session`, user-state types, wallet helpers, AA helpers |
| `@aomi-labs/cli` | The `aomi` terminal command |
| `@aomi-labs/account` | Server-only account graph, Better Auth, SIWE/provider exchange, authorization policy, service topology. Shared auth runs in the Edge Worker; Build session signing is shared with the Build server |
| `@aomi-labs/app-kit` | Shared Vite/Nitro config for the TanStack Start apps (`vite`, `platform`, `http`, `url-search`) |
| `@aomi-labs/widget` | Chat UI and wallet provider adapters |

## Stack

- React 19 / TanStack Start (Vite + Nitro, `vercel` and `cloudflare-module` presets) / TypeScript
- `@assistant-ui/react` for chat primitives
- Radix UI + Tailwind CSS 4 for styling
- Better Auth for browser/device sessions, served by the Edge Worker (`apps/edge`)
- `tsup` for publishable package bundles

## Package Entrypoints

| Package | Main exports |
| --- | --- |
| `@aomi-labs/react` | `AomiRuntimeProvider`, runtime hooks and handlers; client types come from `@aomi-labs/client` |
| `@aomi-labs/client` | `Aomi` (threads, turns, commits, `aomi.account`), `AomiClient`, `/viem`, `/solana`, `/node` signer helpers, `/trace` decoder. The terminal command is provided by `@aomi-labs/cli` |
| `@aomi-labs/cli` | `aomi` terminal command (Stricli commands, pi-tui chat; `aomi login` device code or `--private-key`) |
| `@aomi-labs/account` | `./build-session`, `./account`, `./better-auth`, `./policy`, `./principal`, `./providers`, `./widget-auth` |

## Directory Structure

```
packages/client/src/
├── client.ts                      # AomiClient HTTP/SSE transport
├── session.ts                     # ClientSession re-export
├── session/                       # ClientSession implementation and wallet controller
├── account-session.ts             # Optional Edge bearer provider for cross-origin clients
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
├── policy.ts                      # Capabilities, OAuth resource policies, authorize
├── principal.ts                   # Caller identity from one credential
├── better-auth/                   # Better Auth config, SIWE, provider plugin, env
├── providers/                     # Privy/Para token verification and embedded-wallet listing
├── service/                       # account graph, provider exchange, wallet linking
├── db/                            # Account graph schema and queries
└── widget-auth/                   # Widget sessions and tickets

apps/edge/src/                     # The Cloudflare Worker: proxy, auth, account, Build BFF

packages/widget/src/wallet/        # Wallet provider adapters
apps/landing/                      # Marketing, docs and registry (TanStack Start, prerendered)
apps/portal/                       # Chat portal pages (TanStack Start; no server routes)
apps/build/                        # Aomi Build control plane (TanStack Start)
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

Apps (public, inlined at build; keys in `apps/*/public-env.keys.json`):

```
NEXT_PUBLIC_BACKEND_URL       # Browser backend base; "/" uses the Edge on the same origin
NEXT_PUBLIC_PROJECT_ID        # Reown/WalletConnect project id for demos
AOMI_DEPLOY_TARGET            # vercel (default) or cloudflare: the Nitro preset
```

Edge Worker (`apps/edge/src/env.ts`; secrets pushed by product-mono's deploy, Hyperdrive binding):

```
HYPERDRIVE                    # Postgres for auth and the account graph
BETTER_AUTH_SECRET            # Better Auth secret
BETTER_AUTH_URL               # Public portal origin Better Auth issues for
EDGE_SERVICE_PRIVATE_KEY      # Ed25519 key the edge mints service bearers with
PORTAL_HOSTS, PORTAL_UPSTREAM_ORIGIN   # likewise LANDING_* and BUILD_*
PRIVY_APP_ID, PRIVY_APP_SECRET, PARA_API_KEY   # provider verification
```

The real Better Auth browser cookie is `better-auth.session_token`.

## Ports

- 3000: Landing/demo app
- 3001: Portal app in local auth-stack flows
- 8080: Backend API

## Build Output Policy

`packages/react` and `packages/client` both publish from `dist/`, and their `package.json` exports point at `dist` files. Generated `dist/` trees are not committed; deterministic prepack hooks build package contents.

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

All backend session/thread endpoints carry `X-Session-Id`. Same-origin browser calls rely on the Edge Worker to translate the Better Auth cookie into a backend `AccountBearer`; direct cross-origin calls can opt into `createAccountAccessTokenProvider`.
