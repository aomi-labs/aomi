# Aomi

**The best blockchain harness for agentic AI - on-chain execution with runtime, skills, and component library.** Aomi ships five entry points from one repo — a React widget, a headless runtime, a TypeScript client, a CLI, and an agent skill — all backed by an Aomi-compatible backend.

- **Widget** — `<AomiFrame />`, a drop-in React chat component with wallet actions.
- **Headless runtime** — `@aomi-labs/react` hooks and providers that manage concurrent threads, backend polling, control state, and wallet events, with no UI opinions.
- **TypeScript client** — `@aomi-labs/client`, a platform-agnostic client for Node.js and browsers.
- **CLI** — `aomi`, a terminal client for chatting with Aomi agents and signing on-chain transactions directly from your shell.
- **Agent skill** — `aomi-transact`, a Claude / Codex skill that teaches an AI agent to operate the CLI as an on-chain tool.
- **License:** MIT

## What is Aomi?

Aomi is an AI-assistant framework for on-chain apps. It gives you an agent that can answer questions about crypto, DeFi, wallets, and markets — and, when asked, queue real wallet transactions that your user (or your own key, from the CLI) can sign.

You pick how you integrate:

| Entry point       | Package                          | Use when you want…                                   |
| ----------------- | -------------------------------- | ---------------------------------------------------- |
| React widget      | `@aomi-labs/widget-lib`          | A prebuilt chat UI inside a web app                  |
| Headless runtime  | `@aomi-labs/react`               | Your own UI on top of Aomi's thread + wallet runtime |
| TypeScript client | `@aomi-labs/client`              | Node or browser programmatic access, no React        |
| CLI               | `@aomi-labs/client` (`aomi` bin) | Chat + sign transactions from a terminal             |
| Agent skill       | `skills/aomi-transact`           | Let an AI agent use Aomi as a tool                   |

All entry points share a common backend API, so a conversation started in the widget can be continued from the CLI and vice versa.

## Key features

- **AI chat + on-chain actions in one loop** — the agent can queue wallet requests inside any conversation.
- **Drop-in React widget** — one `<AomiFrame />` tag renders the full chat, sidebar, and composer.
- **Headless runtime for custom UIs** — concurrent thread management, per-thread model/namespace state, backend polling/SSE, event bus, and wallet request handler, exposed as React hooks.
- **Terminal-first CLI** — `aomi chat`, `aomi tx list`, `aomi tx simulate`, `aomi tx sign`, session management, secret ingestion.
- **Account auth in CLI** — `aomi account login` opens a backend-minted Privy auth URL, and `aomi account whoami` confirms the backend session is bound to an Aomi account.
- **Account Abstraction built in** — EIP-4337 and EIP-7702 signing via Alchemy or Pimlico, with automatic mode fallback.
- **Batch simulation** — dry-run multi-step flows (approve → swap) on a forked chain before signing.
- **Agent-ready** — install `aomi-transact` as a Claude/Codex skill and your agent can transact on-chain autonomously.
- **Provider-agnostic wallet** — Para + wagmi recommended; bring your own adapter if needed.
- **Shared session model** — threads, messages, and wallet requests flow through the same backend API across widget, runtime, CLI, and skill.

## Install

Pick the package for your entry point. All five live in this monorepo.

```bash
# React widget + UI components
pnpm install @aomi-labs/react @aomi-labs/widget-lib

# Headless runtime only (no UI)
pnpm install @aomi-labs/react

# TypeScript client (Node / browser, no React)
pnpm install @aomi-labs/client

# CLI (installs the `aomi` executable)
npm install -g @aomi-labs/client
```

Or copy widget source into your repo via the shadcn registry:

```bash
npx shadcn add https://aomi.dev/r/aomi-frame.json
```

---

## Widget: `<AomiFrame />`

A prebuilt React chat widget for on-chain AI assistants. Without wallet providers, chat works and wallet actions stay disabled.

```tsx
import { AomiFrame } from "@aomi-labs/widget-lib";

export function Assistant() {
  return <AomiFrame height="640px" width="100%" />;
}
```

### With wallet providers

Wrap the frame in `AomiWalletKitProvider` to enable wallet connection and transaction requests. External wallets such as MetaMask, Rabby, Rainbow, Coinbase Wallet, and WalletConnect are configured through the generic EVM wallet catalog; Para/Privy are only needed when you want their auth session or embedded-wallet features.

```tsx
import { AomiFrame, AomiWalletKitProvider } from "@aomi-labs/widget-lib";

export function Assistant() {
  return (
    <AomiWalletKitProvider
      wallets={{
        evm: {
          wallets: ["metamask", "rabby", "walletconnect", "coinbase"],
          walletConnectProjectId:
            process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
        },
      }}
      execution={{
        aa: "optional",
        provider: "pimlico",
        modes: ["4337"],
        owner: "external-wallet",
      }}
    >
      <AomiFrame height="640px" width="100%" />
    </AomiWalletKitProvider>
  );
}
```

To add Para auth or embedded wallets, keep the same external-wallet config and add a Para auth provider:

```tsx
import "@aomi-labs/widget-lib/providers/para";
import { AomiFrame, AomiWalletKitProvider } from "@aomi-labs/widget-lib";

export function Assistant() {
  return (
    <AomiWalletKitProvider
      auth={{ provider: "para", methods: ["google", "email", "wallet"] }}
      providers={{
        para: {
          apiKey: process.env.NEXT_PUBLIC_PARA_API_KEY,
          environment: "BETA",
        },
      }}
      wallets={{
        evm: {
          wallets: ["metamask", "rabby", "walletconnect"],
          walletConnectProjectId:
            process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
        },
      }}
    >
      <AomiFrame height="640px" width="100%" />
    </AomiWalletKitProvider>
  );
}
```

Base Account is also a generic wallet entry now:

```tsx
import { AomiFrame, AomiWalletKitProvider } from "@aomi-labs/widget-lib";
import { base } from "wagmi/chains";

export function Assistant() {
  return (
    <AomiWalletKitProvider
      wallets={{
        evm: {
          chains: [base],
          wallets: ["baseAccount"],
          coinbase: false,
          appName: "Aomi",
        },
        solana: false,
      }}
      execution={{
        aa: "optional",
        sponsorship: {
          mode: "optional",
          paymasterServiceUrl: "/api/paymaster",
        },
      }}
    >
      <AomiFrame height="640px" width="100%" />
    </AomiWalletKitProvider>
  );
}
```

`AomiBaseAccountProvider` remains as a deprecated compatibility wrapper, but new integrations should use `AomiWalletKitProvider`.

### AomiFrame props

| Prop             | Type                           | Default                                       | Description                         |
| ---------------- | ------------------------------ | --------------------------------------------- | ----------------------------------- |
| `width`          | `CSSProperties["width"]`       | `"100%"`                                      | Container width                     |
| `height`         | `CSSProperties["height"]`      | `"80vh"`                                      | Container height                    |
| `className`      | `string`                       | -                                             | Additional CSS classes              |
| `style`          | `CSSProperties`                | -                                             | Inline styles                       |
| `walletPosition` | `"header" \| "footer" \| null` | `"footer"`                                    | Where to show wallet connect button |
| `backendUrl`     | `string`                       | `NEXT_PUBLIC_BACKEND_URL` or `localhost:8080` | Backend API URL                     |

### Compound components

```tsx
import { AomiFrame } from "@aomi-labs/widget-lib";

<AomiFrame.Root height="600px" backendUrl="https://api.example.com">
  <AomiFrame.Header
    withControl={true}
    controlBarProps={{ hideWallet: true, hideApiKey: true }}
  />
  <AomiFrame.Composer />
</AomiFrame.Root>;
```

### ControlBar

`ControlBar` provides model selection, namespace/agent selection, API key input, and wallet connection.

```tsx
import { ControlBar } from "@aomi-labs/react";

<ControlBar hideModel hideApiKey />;
```

| Prop            | Type        | Default | Description                   |
| --------------- | ----------- | ------- | ----------------------------- |
| `className`     | `string`    | -       | Additional CSS classes        |
| `children`      | `ReactNode` | -       | Custom controls to render     |
| `hideModel`     | `boolean`   | `false` | Hide model selector           |
| `hideNamespace` | `boolean`   | `false` | Hide namespace/agent selector |
| `hideApiKey`    | `boolean`   | `false` | Hide API key input            |
| `hideWallet`    | `boolean`   | `false` | Hide wallet connect button    |

Individual pieces (`ModelSelect`, `NamespaceSelect`, `ApiKeyInput`, `ConnectButton`) are also exported from `@aomi-labs/widget-lib/control-bar` for fully custom layouts.

---

## Headless runtime: `@aomi-labs/react`

The headless runtime is the engine under `<AomiFrame />`. Use it directly when you want your own UI.

It manages:

- **Concurrent threads** — create, switch, rename, archive, and delete chat threads; each thread has its own message history, model, namespace, and processing state.
- **Backend orchestration** — polling and SSE with the Aomi backend, including `/api/chat`, `/api/state`, `/api/interrupt`, `/api/system`, and `/api/sessions/*`.
- **Per-thread control state** — selected model, selected namespace/agent, dirty flag, `isProcessing` — all scoped per thread.
- **Wallet request handler** — `useWalletHandler()` subscribes to inbound wallet transaction requests and routes signed results back to the backend.
- **User + event contexts** — wallet state auto-syncs via `onUserStateChange`, system events flow through a typed event buffer.

### Mount the runtime

```tsx
import { ThreadContextProvider, AomiRuntimeProvider } from "@aomi-labs/react";

export function App({ children }) {
  return (
    <ThreadContextProvider>
      <AomiRuntimeProvider backendUrl="https://api.aomi.dev">
        {children}
      </AomiRuntimeProvider>
    </ThreadContextProvider>
  );
}
```

### useAomiRuntime

Programmatic control over threads, messages, and user state.

```tsx
import { useAomiRuntime } from "@aomi-labs/react";

function MyComponent() {
  const {
    currentThreadId,
    createThread,
    selectThread,
    deleteThread,
    sendMessage,
    getMessages,
    isRunning,
    user,
    setUser,
  } = useAomiRuntime();

  return <button onClick={() => sendMessage("Hello!")}>Send</button>;
}
```

### useControl

Model, namespace, and API key state — persisted to `localStorage` where appropriate.

```tsx
import { useControl } from "@aomi-labs/react";

function Controls() {
  const {
    state, // { namespace, apiKey, availableModels, authorizedNamespaces, ... }
    onModelSelect,
    onNamespaceSelect,
    setApiKey,
  } = useControl();

  return <div>Namespace: {state.namespace}</div>;
}
```

### useWalletHandler

Subscribe to inbound wallet transaction requests surfaced by the backend.

```tsx
import { useWalletHandler } from "@aomi-labs/react";

useWalletHandler({
  onTxRequest: async (req) => {
    const hash = await mySigner.sendTransaction(req.payload);
    return { txHash: hash };
  },
});
```

---

## TypeScript client: `@aomi-labs/client`

Platform-agnostic client for Node.js and browsers. No React, no UI.

```ts
import { AomiClient, Session } from "@aomi-labs/client";

// Low-level: direct HTTP/SSE access
const client = new AomiClient({ baseUrl: "https://api.aomi.dev" });
await client.createThread(crypto.randomUUID());

// High-level: polls, dispatches events, manages wallet requests
const session = new Session(client, { namespace: "default" });
const result = await session.send("Swap 1 ETH for USDC on Uniswap");

session.on("wallet_tx_request", async (req) => {
  const signed = await mySigner.signTransaction(req.payload);
  await session.resolve(req.id, { txHash: signed.hash });
});
```

See [`packages/client/README.md`](packages/client/README.md) for the full `Session` API.

---

## CLI: `aomi`

The `aomi` CLI lets you chat with Aomi agents and sign on-chain transactions directly from your terminal. Installing `@aomi-labs/client` globally exposes the `aomi` binary.

```bash
npm install -g @aomi-labs/client
aomi --version
```

### Two entry shapes

```bash
# Interactive REPL (reuses active session)
aomi

# One-shot prompt
aomi --prompt "what is the price of ETH?"

# Noun-verb subcommands for durable workflows
aomi chat "swap 1 ETH for USDC" --public-key 0xYourAddress --chain 1
aomi tx list
aomi tx simulate tx-1 tx-2
aomi tx sign tx-1 tx-2 --private-key 0xYourPrivateKey --rpc-url https://eth.llamarpc.com
aomi session list|new|resume|delete|status|log|events|close
aomi model list|set|current
aomi app list|current
aomi chain list
aomi secret add NAME=value
```

### Example: swap with account abstraction

```bash
export ALCHEMY_API_KEY=your-alchemy-key
export ALCHEMY_GAS_POLICY_ID=your-gas-policy-id
export PRIVATE_KEY=0xYourPrivateKey

aomi chat "swap 100 USDC for ETH" --public-key 0xYourAddress --chain 1
aomi tx sign tx-1    # auto-detects AA, tries 7702 then 4337, errors if both fail
```

### AA execution model

| AA configured? | Flag                          | Result                                                        |
| -------------- | ----------------------------- | ------------------------------------------------------------- |
| Yes            | (none)                        | AA automatically (preferred mode → alternative mode fallback) |
| Yes            | `--aa-provider` / `--aa-mode` | AA with explicit settings                                     |
| Yes            | `--eoa`                       | EOA, skip AA                                                  |
| No             | (none)                        | EOA                                                           |
| No             | `--aa-provider`               | Error: AA requires provider credentials                       |

There is **no silent EOA fallback** — if AA is selected and both modes fail, the CLI returns a hard error suggesting `--eoa`. Supported providers: **Alchemy** (4337 sponsored + 7702) and **Pimlico** (4337 sponsored).

### Batch simulation

`aomi tx simulate` runs pending transactions sequentially on a forked chain so state-dependent flows (approve → swap) are validated as a batch. Returns per-step success, revert reasons, and gas usage without modifying on-chain state.

See [`aomi-labs/skills/aomi-transact/SKILL.md`](https://github.com/aomi-labs/skills/blob/main/aomi-transact/SKILL.md) for the complete CLI reference.

---

## Agent skill: `aomi-transact`

`aomi-transact` is an agent skill that teaches an AI assistant (Claude, Codex, etc.) to drive the Aomi CLI — inspect sessions, build wallet requests, simulate batches, sign with AA or EOA, switch apps and chains, and ingest per-session secrets.

Install via the skills registry:

```bash
npx skills add aomi-labs/skills
```

The skill file lives at [`aomi-labs/skills/aomi-transact/SKILL.md`](https://github.com/aomi-labs/skills/blob/main/aomi-transact/SKILL.md) and includes:

- Hard rules for handling private keys and API keys safely.
- The default chat → review → simulate → sign workflow.
- Full command, flag, and environment variable reference.
- AA provider and mode selection guidance per chain.
- Integrated-app catalog (Binance, Bybit, CoW, DefiLlama, Dune, dYdX, GMX, Hyperliquid, Kaito, Kalshi, Khalani, LI.FI, Manifold, Morpho, Neynar, OKX, 1inch, Polymarket, X, Yearn, 0x, and more).
- Troubleshooting for RPC, simulation, and AA failures.

A companion skill, `aomi-build`, scaffolds new backend apps from OpenAPI specs, REST endpoints, or SDK examples.

---

## FAQ

### What can an Aomi agent actually do?

Answer questions about crypto, DeFi, markets, wallets, and on-chain state — and, when authorized, queue real wallet transactions (swaps, transfers, approvals, cross-chain intents, prediction-market bets, perps orders) that the user or CLI signs.

### Do I need a wallet to use Aomi?

No. In the widget, chat works without any wallet provider and wallet actions stay disabled. In the CLI, read-only flows (prices, balances, quotes) work without a private key.

### Is Aomi hosted or self-hosted?

The packages in this repo are client libraries. They talk to an **Aomi-compatible backend** reachable via `NEXT_PUBLIC_BACKEND_URL` (widget/runtime) or `AOMI_BACKEND_URL` / `--backend-url` (CLI). You can run that backend yourself or use a hosted Aomi endpoint.

### What's the difference between `@aomi-labs/react` and `@aomi-labs/widget-lib`?

- `@aomi-labs/react` — headless runtime, contexts, and hooks. No UI.
- `@aomi-labs/widget-lib` — prebuilt UI components (`AomiFrame`, `ControlBar`, etc.) built on top of the runtime.

Install both for the default experience, or install only `@aomi-labs/react` if you're building a custom UI.

### When should I use the CLI vs. the widget?

- **Widget / runtime** — when a human user will connect a wallet in the browser and sign requests themselves.
- **CLI** — when you (the developer) want to script or run on-chain flows from your terminal with a local private key, or when an AI agent should drive Aomi as a tool.

### Which chains and AA modes are supported?

Ethereum, Polygon, Arbitrum, Base, Optimism, and Sepolia. AA uses EIP-4337 (bundler + paymaster) or EIP-7702 (native delegation). Default mode is 7702 on Ethereum, 4337 on L2s.

### Does it support streaming and tool calls?

Yes. The runtime streams assistant messages and dispatches tool calls and system events — including wallet transaction requests — through a typed event bus.

### How does an AI agent use Aomi?

Install the `aomi-transact` skill. The agent then uses the `aomi` CLI as a tool, following the skill's workflow rules for session management, simulation, and signing. No custom integration code needed.

---

## Requirements

- **React:** 18 or 19 (widget and runtime)
- **Node:** 18+ (CLI and client)
- **Next.js:** 14+ recommended for the widget
- **Tailwind CSS:** v4 (widget)
- **Backend:** an Aomi-compatible backend reachable over HTTP/SSE
- **Optional for wallet UX:** `@getpara/react-sdk`, `wagmi`, `@tanstack/react-query`
- **Optional for CLI AA:** `ALCHEMY_API_KEY` and/or `PIMLICO_API_KEY`

## Development

This is a pnpm monorepo.

```bash
pnpm install
pnpm run build:lib            # Build the widget/runtime library
pnpm run build:client         # Build the TypeScript client + CLI
pnpm --filter landing dev     # Run demo at localhost:3000
pnpm run dev:landing:live     # Watch library + demo together
pnpm lint                     # Lint check
pnpm test                     # Run tests
```

### Repo layout

```
packages/
  react/       # @aomi-labs/react — headless runtime, contexts, hooks
  client/      # @aomi-labs/client — TypeScript client + `aomi` CLI + skills
apps/
  registry/    # @aomi-labs/widget-lib — shadcn-installable UI components
  landing/     # Demo Next.js app (localhost:3000)
```

## Environment variables

Widget / runtime:

```
NEXT_PUBLIC_PROJECT_ID=your_reown_project_id
NEXT_PUBLIC_BACKEND_URL=http://localhost:8080
```

CLI (optional):

```
AOMI_BACKEND_URL=https://api.aomi.dev
AOMI_API_KEY=...
PRIVATE_KEY=0x...
CHAIN_RPC_URL=https://eth.llamarpc.com
ALCHEMY_API_KEY=...
ALCHEMY_GAS_POLICY_ID=...
PIMLICO_API_KEY=...
AOMI_STATE_DIR=~/.aomi
```

Get your Reown Project ID from [Reown](https://docs.reown.com/).

## License

MIT
