# @aomi-labs/client

TypeScript client for the Aomi on-chain agent backend. Works in Node.js and browsers.

## Public authorization

With no auth option, `Aomi` creates and reuses an anonymous session for the
guest-safe REST surface. For a signed-in CLI, bot, or server process, configure
OAuth once and let the SDK own exact resources, scopes, refresh, and revocation:

```ts
import { Aomi, oauth } from "@aomi-labs/client";

const aomi = new Aomi({
  baseUrl: "https://chat.aomi.dev",
  auth: oauth({
    clientId: process.env.AOMI_CLIENT_ID!,
    store: myDurableGrantStore,
    onVerification({ verificationUriComplete, verificationUri, userCode }) {
      console.log(
        `Open ${verificationUriComplete ?? verificationUri}: ${userCode}`,
      );
    },
  }),
});

// Optional: Agent and Pipeline calls also acquire grants lazily.
await aomi.auth.login({ for: ["agent", "pipeline"] });
console.log(await aomi.auth.status());
await aomi.auth.logout();
```

Agent REST uses the exact OAuth resource `https://<portal>/v1/agent`; Pipeline
REST uses `https://<portal>/v1/pipeline`. A host that already owns token
acquisition can still supply a low-level `oauth` token provider to
`AomiClient`. Headless grant stores contain rotating refresh tokens and must
be treated as secrets.

The public MCP resources are `https://<portal>/v1/agent/mcp` and
`https://<portal>/v1/pipeline/mcp`. The removed `/api/mcp` and `/api/mcp/direct`
paths are not aliases. MCP always uses Better Auth OAuth with PKCE and an exact
resource audience; anonymous MCP users still complete the normal login,
consent, and token flow.

OAuth providers receive the operation's least-privilege scopes and may return
Bearer or DPoP credentials. The client serializes refresh through one mutex,
retries one invalid-token/insufficient-scope response, and performs one DPoP
nonce retry. It never exposes either internal Aomi service bearer.

## Install

```bash
npm install @aomi-labs/client
# or
pnpm add @aomi-labs/client
```

## Quick Start

### Low-level client

Direct typed access to the Agent and Pipeline transports.

```ts
import { AomiClient } from "@aomi-labs/client";

const client = new AomiClient({ baseUrl: "https://api.aomi.dev" });
const sessions = await client.agent.sessions.list();
console.log(sessions.sessions);
```

### High-level SDK

`Aomi` is the product-oriented facade. Pipeline is a stateless Build flow;
Agent owns its session and turn lifecycle. Supplying `wallet` once exposes
`aomi.wallet`, derives canonical `UserState`, and configures the Agent
`ActionHandler` from primitive wallet capabilities.

```ts
import { Aomi } from "@aomi-labs/client";

const aomi = new Aomi({
  baseUrl: "https://api.aomi.dev",
  wallet: {
    evm: {
      address,
      chainId: 1,
      sendCalls: ({ chainId, calls }) => wallet.sendCalls({ chainId, calls }),
      signMessage: ({ message }) => wallet.signMessage({ message }),
      signTypedData: ({ typedData }) => wallet.signTypedData(typedData),
      switchChain: (chainId) => wallet.switchChain({ chainId }),
    },
  },
});

const build = await aomi.pipeline
  .app("aave")
  .build("supply", { asset: "USDC", amount: "100" });

renderPreview(build.summary, build.actions, build.simulation);
await build.commit(); // commit is always explicit

const agentResult = await aomi.agent.run("Supply 100 USDC to Aave");
console.log(agentResult.messages);

// The wire-close client is always available without a second instance.
await aomi.raw.pipeline.evm.stage({ actions: [] });
```

For event-driven Agent integrations, retain the run object:

```ts
const run = aomi.agent.run("Swap half my USDC and supply the rest");
run.on("action", async (action) => {
  renderAction(action);
  if (await showApprovalUI(action)) {
    await run.session.actions.execute(action.id);
  } else {
    await run.reject(action.id, "User rejected");
  }
});
run.on("completed", console.log);
const result = await run.result();
```

### Low-level Pipeline API

`AomiClient` stays close to the stateless public protocol. Stable EVM and SVM
primitives have distinct DTOs and lifecycle transitions; TypeScript rejects a
commit of a merely staged Build.

```ts
const staged = await client.pipeline.evm.stage({
  actions: [
    {
      chainId: 1,
      calls: [{ to: "0x...", data: "0x", value: 0n }],
    },
  ],
});
const simulated = await client.pipeline.evm.simulate(staged);
const receipt = await client.pipeline.evm.commit(simulated);

const svmStaged = await client.pipeline.svm.stage({
  kind: "instructions",
  instructions,
});
```

The Catalog is filesystem-like and arbitrary live operations deliberately stay
runtime-schema-driven:

```ts
const root = await client.pipeline.root();
const operation = await client.pipeline.app("aave").operation("supply");

const result = await client.pipeline.app("aave").invoke("supply", {
  asset: "USDC",
  amount: "100",
}); // arguments are checked against operation.inputSchema before POST

const skillMarkdown = await client.pipeline
  .skill("leveraged-lending")
  .instructions();
```

Integrations use filesystem discovery, scoped operations, and chain-specific Builds.
The base package does not claim compile-time knowledge of live app or skill
operations; Catalog-specific generation remains a separate later capability.

### Session (high-level)

Owns polling, ordered Event reduction, lifecycle, and Action execution.

```ts
import { Session } from "@aomi-labs/client";

const session = new Session(
  { baseUrl: "https://api.aomi.dev" },
  { app: "default", actions: walletCapabilities },
);

// Blocking send — polls until the agent finishes responding
const result = await session.send("Swap 1 ETH for USDC on Uniswap");
console.log(result.messages);

const unsubscribe = session.subscribe(() => {
  const { actions, turnState } = session.getSnapshot();
  console.log(turnState, actions);
});

await session.actions.execute(actionId);
unsubscribe();
session.close();
```

### Session API

#### Constructor

```ts
new Session(clientOptions: AomiClientOptions, sessionOptions?: SessionOptions)
// or pass an existing AomiClient instance:
new Session(client: AomiClient, sessionOptions?: SessionOptions)
```

| Option           | Default               | Description                                  |
| ---------------- | --------------------- | -------------------------------------------- |
| `sessionId`      | `crypto.randomUUID()` | Agent session ID                             |
| `app`            | `"default"`           | App selected for new turns                   |
| `model`          | —                     | Optional model preference                    |
| `getUserState`   | —                     | Reads canonical UserState when a turn starts |
| `pollIntervalMs` | `500`                 | Event polling interval                       |
| `actions`        | `{}`                  | Canonical wallet/action capabilities         |
| `logger`         | —                     | Pass `console` for debug output              |

#### Methods

| Method                | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `send(message)`       | Send a message, wait for completion, return `{ messages, title }` |
| `sendAsync(message)`  | Send without waiting — poll in background, listen via events      |
| `interrupt()`         | Cancel current processing                                         |
| `sync()`              | Fetch the next ordered EventPage                                  |
| `fetchCurrentState()` | Hydrate from the session Event ledger                             |
| `getSnapshot()`       | Immutable SessionSnapshot                                         |
| `subscribe(listener)` | Subscribe for `useSyncExternalStore`                              |
| `close()`             | Stop polling and release listeners                                |

#### Snapshot

```ts
const unsubscribe = session.subscribe(() => {
  const snapshot = session.getSnapshot();
  console.log(snapshot.cursor, snapshot.turnState, snapshot.events);
});

await session.actions.execute(actionId);
unsubscribe();
```

## CLI

The package includes an `aomi` CLI for scripting. When installed globally or
in a project, the executable name is `aomi`. For one-off usage, run commands
via `npx @aomi-labs/client ...`.

`aomi account login` now uses Better Auth device authorization for both Agent
and Pipeline resources, stores resource-bound rotating grants, and opens the
shared portal login/consent page. `aomi account logout` revokes the saved
refresh/access grants before clearing local state. Native SIWE/SIWS login
remains available through the wallet-specific options.

Claude Code / Codex skills that drive this CLI live in the separate
[`aomi-labs/skills`](https://github.com/aomi-labs/skills) repository — that
repo is the single source of truth for skill content.

```bash
npx @aomi-labs/client --version                         # print installed CLI version
npx @aomi-labs/client                                    # start the interactive REPL
npx @aomi-labs/client --prompt "swap 1 ETH for USDC"    # one-shot prompt mode
npx @aomi-labs/client chat "swap 1 ETH for USDC"        # explicit chat subcommand
npx @aomi-labs/client chat "swap 1 ETH for USDC" --model claude-sonnet-4
npx @aomi-labs/client chat "swap 1 ETH" --verbose        # stream tool calls + responses live
npx @aomi-labs/client --provider-key anthropic:sk-ant-... --prompt "hello"
npx @aomi-labs/client app list                           # list available apps
npx @aomi-labs/client model list                         # list available models
npx @aomi-labs/client model set claude-sonnet-4          # switch the current session model
npx @aomi-labs/client session new                        # create a fresh active session
npx @aomi-labs/client secret list                        # list configured secret handles
npx @aomi-labs/client secret add ALCHEMY_API_KEY=...     # ingest a secret for the active session
npx @aomi-labs/client session log                        # show full conversation history
npx @aomi-labs/client tx list                            # list session Actions
npx @aomi-labs/client tx simulate action-1               # simulate an EVM Action
npx @aomi-labs/client tx export action-1 > execution.json # canonical EIP-5792
npx @aomi-labs/client tx export action-1 --format moss   # MOSS call array
npx @aomi-labs/client tx export action-1 --format metamask # MetaMask handoff
npx @aomi-labs/client tx sign action-1                   # execute a pending Action
npx @aomi-labs/client session status                     # session info
npx @aomi-labs/client session events                     # system events
npx @aomi-labs/client session close                      # clear session
npx @aomi-labs/client pipeline apps --filter solana
npx @aomi-labs/client pipeline operations --app svm-read-only --filter balance
npx @aomi-labs/client pipeline operation svm_get_balance --app svm-read-only
npx @aomi-labs/client pipeline invoke svm_get_balance --app svm-read-only --arguments '{"address":"..."}'
npx @aomi-labs/client pipeline build supply --app aave --arguments @supply.json > build.json
npx @aomi-labs/client pipeline evm commit build.json
```

The root command now mirrors the Rust CLI shape:

- `aomi` starts an interactive REPL with `/app`, `/model`, `/key`, and `:exit`.
- `aomi --prompt "..."` sends a single prompt and exits.
- The noun-verb subcommands remain available for transaction, session, secret, and control flows.

### Pipeline CLI

Pipeline commands use the same filesystem scopes and Build types as the
TypeScript SDK. The normal operation flow is discover, build, inspect, then
commit:

```bash
aomi pipeline operations --app aave
aomi pipeline build supply --app aave --arguments @supply.json > build.json
aomi pipeline evm commit build.json
```

`--arguments` and raw lifecycle inputs accept inline JSON, a file path,
`@file`, or `-` for stdin. Results are JSON on stdout, while payment progress
uses stderr, so Builds can be safely redirected or piped. `commit` accepts only
a simulated Build and does not implicitly sign returned wallet requests.

Use `aomi pipeline evm ...` or `aomi pipeline svm ...` for direct
`build`, `stage`, `simulate`, and `commit` control. `aomi pipeline read [path]`
is the generic Catalog escape hatch.

### Wallet connection

Pass `--public-key` so the agent knows your wallet address. This lets it build
transactions and check your balances:

```bash
npx @aomi-labs/client chat "send 0 ETH to myself" \
  --public-key 0x5D907BEa404e6F821d467314a9cA07663CF64c9B
```

The address is persisted in the state file, so subsequent commands in the same
session don't need it again. `--public-key` is EVM-only (a 0x-prefixed
address); Solana identities are configured with `wallet set --solana` or
`--solana-private-key`.

### Persisted wallets

`aomi wallet set` persists a signing key and its derived address. EVM is the
default; pass `--solana` for a Solana keypair. Setting a Solana wallet also
persists its cluster (`solana:mainnet` unless `--cluster` says otherwise):

```bash
aomi wallet set 0xYOUR_EVM_PRIVATE_KEY
aomi wallet set --solana YOUR_BASE58_SOLANA_KEY
aomi wallet set --solana YOUR_BASE58_SOLANA_KEY --cluster devnet
```

`aomi wallet current --json` reports every configured wallet family. The
`family` values match the backend wire keys (`evm`, `svm`):

```json
{
  "active": true,
  "wallets": [
    {
      "family": "evm",
      "address": "0x5D907BEa404e6F821d467314a9cA07663CF64c9B",
      "chainId": 1,
      "hasSavedSigner": true
    },
    {
      "family": "svm",
      "address": "GkzrnLXeGFXQDPtx6WcbTKfvNQ5D6DBXWXWuz6dHzXsG",
      "cluster": "solana:mainnet",
      "hasSavedSigner": true
    }
  ]
}
```

### Chain selection

Use `--chain <id>` for the current command when the task is chain-specific:

```bash
$ npx @aomi-labs/client chat "swap 1 POL for USDC on Polygon" --chain 137
```

Use `AOMI_CHAIN_ID` when several consecutive commands should share the same
chain context.

### Fresh sessions

Use `--new-session` when you want a command to start a fresh backend/local
session instead of reusing the currently active one:

```bash
$ npx @aomi-labs/client chat "show my balances" --new-session
$ npx @aomi-labs/client secret add ALCHEMY_API_KEY=... --new-session
$ npx @aomi-labs/client session new
```

This is useful when starting a new operator flow or a new external chat thread
and you do not want stale session state to bleed into the next run.

### Model selection

The CLI can discover and switch backend models for the active session:

```bash
$ npx @aomi-labs/client model list
claude-sonnet-4
gpt-5

$ npx @aomi-labs/client model set gpt-5
Model set to gpt-5

$ npx @aomi-labs/client chat "hello" --model claude-sonnet-4
```

`aomi model set` persists the selected model in the local session state after a
successful backend update. `aomi chat --model ...` applies the requested model
before sending the message and updates that persisted state as well.

### Secret management

The CLI supports per-session secret ingestion. This lets the backend use opaque
handles instead of raw secret values:

```bash
$ npx @aomi-labs/client secret add ALCHEMY_API_KEY=sk_live_123
Configured 1 secret for session 7f8a...
ALCHEMY_API_KEY  $SECRET:ALCHEMY_API_KEY

$ npx @aomi-labs/client secret add ALCHEMY_API_KEY=sk_live_123 --new-session
$ npx @aomi-labs/client --prompt "simulate a swap on Base"
```

You can inspect or clear the current session's secret handles:

```bash
$ npx @aomi-labs/client secret list
ALCHEMY_API_KEY  $SECRET:ALCHEMY_API_KEY

$ npx @aomi-labs/client secret clear
Cleared all secrets for the active session.
```

### Transaction flow

The backend exposes durable Actions containing the simulated transactions or
signing payloads that need a wallet response:

```
$ npx @aomi-labs/client chat "swap 1 ETH for USDC on Uniswap" --public-key 0xYourAddr --chain 1
⚡ Action awaiting response: action-1
   EVM transactions: 1

$ npx @aomi-labs/client tx list
⏳ action-1  1 EVM transaction  (pending, revision 1)

$ npx @aomi-labs/client tx simulate action-1
All steps passed.

$ npx @aomi-labs/client tx export action-1 > execution.json

$ npx @aomi-labs/client tx sign action-1 --private-key 0xac0974...
⏳ action-1  1 EVM transaction  (pending, revision 1)
✅ action-1 submitted

$ npx @aomi-labs/client tx list
✅ action-1  1 EVM transaction  (submitted, revision 2)
```

`aomi tx export <id>...` refreshes the backend's authoritative pending state
and writes a wallet handoff artifact to stdout. It requires no private key,
preserves the selected call order, and fails if the calls do not share one
sender and chain. Redirect stdout to keep the artifact separate from
diagnostics:

```bash
aomi tx export action-1 action-2 > execution.json
```

The default `eip5792` format is the canonical export. It contains an EIP-5792
`wallet_sendCalls` version `2.0.0` parameter object with hexadecimal `chainId`
and `value` quantities, `atomicRequired: false`, and `to`/`data`/`value` call
tuples. `moss` and `metamask` are small adapters over that representation:

| Format     | Output                                               | Batch behavior            |
| ---------- | ---------------------------------------------------- | ------------------------- |
| `eip5792`  | Full `wallet_sendCalls` parameter object             | Preserves all calls       |
| `moss`     | Ordered call array                                   | Preserves all calls       |
| `metamask` | Numeric `chainId` plus one raw transaction `payload` | Requires exactly one call |

The command does not sign, broadcast, notify the backend, or resolve the
pending Action. Simulate the same ordered selection before handing it to an
external wallet.

MegaETH MOSS consumes the call array directly:

```bash
aomi tx export action-1 action-2 --format moss > moss-calls.json
mega moss execute --calls moss-calls.json --network mainnet --json
```

MOSS still requires its own wallet login and an approved delegated key whose
call and spend permissions cover every exported call.

MetaMask browser and mobile wallets consume the default EIP-5792 object through
an EIP-1193 provider. Check `wallet_getCapabilities` for the selected account
and chain before requesting execution:

```ts
const execution = JSON.parse(await readFile("execution.json", "utf8"));
await provider.request({
  method: "wallet_sendCalls",
  params: [execution],
});
```

MetaMask Agent Wallet currently exposes one raw EVM transaction at a time. The
`metamask` format keeps its required decimal chain argument beside the
hexadecimal transaction payload:

```bash
aomi tx export action-1 --format metamask > metamask.json
mm wallet send-transaction \
  --chain-id "$(jq -r '.chainId' metamask.json)" \
  --payload "$(jq -c '.payload' metamask.json)" \
  --wait
```

The `metamask` format rejects multiple calls instead of turning a batch into
unrelated sequential transactions. Use the default `eip5792` format for native
MetaMask batch execution when the connected account advertises that
capability.

**EIP-712 signing** is also supported. When an Action requests a typed-data
signature, `aomi tx sign` routes it through the configured local EVM wallet and
submits the signed result to the backend:

```
$ npx @aomi-labs/client tx list
⏳ action-2  EVM signature  (pending, revision 1)

$ npx @aomi-labs/client tx sign action-2 --private-key 0xac0974...
⏳ action-2  EVM signature  (pending, revision 1)
✅ action-2 completed
```

Local Action execution is EOA. The CLI rejects `--aa`; account-abstraction
execution and the `--aa-provider` / `--aa-mode` preferences belong to the
backend execution lane.

### Verbose mode & conversation log

Use `--verbose` (or `-v`) to see tool calls and agent responses in real-time:

```
$ npx @aomi-labs/client chat "what's the price of ETH?" --verbose
⏳ Processing…
🔧 [tool] get_token_price: running
✔ [tool] get_token_price → {"price": 2045.67, "symbol": "ETH"}
🤖 ETH is currently trading at $2,045.67.
✅ Done
```

Without `--verbose`, only the final agent message is printed.

Use `aomi session log` to replay the full conversation with all messages and tool results:

```
$ npx @aomi-labs/client session log
10:30:15 AM 👤 You: what's the price of ETH?
10:30:16 AM 🤖 Agent: Let me check the current on-chain context for you.
10:30:16 AM 🔧 [Current ETH price] {"price": 2045.67, "symbol": "ETH"}
10:30:17 AM 🤖 Agent: ETH is currently trading at $2,045.67.

— 4 messages —
```

### Options

All config can be passed as flags (which take priority over env vars):

| Flag                   | Env Variable          | Default                 | Description                                  |
| ---------------------- | --------------------- | ----------------------- | -------------------------------------------- |
| `--backend-url`        | `AOMI_BACKEND_URL`    | `https://chat.aomi.dev` | Aomi API/BFF URL                             |
| `--api-key`            | `AOMI_API_KEY`        | —                       | API key for non-default apps                 |
| `--app`                | `AOMI_APP`            | `default`               | App                                          |
| `--model`              | `AOMI_MODEL`          | —                       | Model rig to apply before chat               |
| `--prompt`, `-p`       | —                     | —                       | Send a single prompt and exit                |
| `--show-tool`          | —                     | —                       | Show tool output in root prompt/REPL mode    |
| `--provider-key`       | —                     | —                       | Save a BYOK provider key as `PROVIDER:KEY`   |
| `--public-key`         | `AOMI_PUBLIC_KEY`     | —                       | EVM wallet address (0x-prefixed)             |
| `--private-key`        | `PRIVATE_KEY`         | —                       | Hex private key for `aomi tx sign`           |
| `--solana-private-key` | `SOLANA_PRIVATE_KEY`  | —                       | Solana keypair (base58 or JSON byte array)   |
| `--cluster`            | `AOMI_SOLANA_CLUSTER` | `mainnet-beta`          | Solana cluster (also CAIP-2 `solana:...`)    |
| `--rpc-url`            | `CHAIN_RPC_URL`       | —                       | RPC URL for transaction submission           |
| `--chain`              | `AOMI_CHAIN_ID`       | `1`                     | Chain ID (1, 137, 42161, 8453, 10, 11155111) |
| `--json`               | —                     | —                       | Machine-readable JSON where supported        |
| `--verbose`, `-v`      | —                     | —                       | Stream tool calls and agent responses live   |
| `--version`, `-V`      | —                     | —                       | Print the installed CLI version              |

```bash
# Use a custom backend
npx @aomi-labs/client chat "hello" --backend-url https://my-backend.example.com

# Full signing flow with all flags
npx @aomi-labs/client chat "send 0.1 ETH to vitalik.eth" \
  --public-key 0xYourAddress \
  --api-key sk-abc123 \
  --app my-agent \
  --model claude-sonnet-4
npx @aomi-labs/client tx sign action-1 \
  --private-key 0xYourPrivateKey \
  --rpc-url https://eth.llamarpc.com
```

### Signing modes

`aomi tx sign` executes Actions with the configured local wallet. EVM
transactions use direct EOA execution; `--eoa` makes that choice explicit and
`--aa` is rejected because account abstraction now belongs to the backend
execution lane. EVM and SVM message or typed-data requests use the matching
local signing capability.

### How state works

The CLI is **not** a long-running process — each command starts, runs, and
exits. Conversation history lives on the backend. Between invocations, the CLI
persists local state under `AOMI_STATE_DIR` or `~/.aomi` by default:

| Field           | Purpose                                                |
| --------------- | ------------------------------------------------------ |
| `sessionId`     | Which conversation to continue                         |
| `clientId`      | Stable client identity used for session secret handles |
| `model`         | Last successfully applied model for the session        |
| `publicKey`     | EVM wallet address (from `--public-key`)               |
| `privateKey`    | EVM key persisted by `aomi wallet set`                 |
| `chainId`       | Active chain ID (from `--chain`)                       |
| `svmPublicKey`  | Solana address (from `wallet set --solana`)            |
| `svmPrivateKey` | Solana key persisted by `wallet set --solana`          |
| `svmCluster`    | Solana cluster; always set when `svmPublicKey` is set  |
| `secretHandles` | Opaque handles returned for ingested secrets           |
| `auth`          | Current CLI account authentication                     |
| `oauthGrants`   | Saved scoped OAuth grants                              |

```
$ npx @aomi-labs/client chat "hello"           # creates session, saves sessionId
$ npx @aomi-labs/client chat "swap 1 ETH"      # reuses the Agent session and receives an Action
$ npx @aomi-labs/client tx list                 # refreshes Actions from the backend
$ npx @aomi-labs/client tx sign action-1        # executes and submits the Action result
$ npx @aomi-labs/client session close           # clears the active local session pointer
```

Session files live under `~/.aomi/sessions/` by default, with an active session
pointer stored in the state root.
