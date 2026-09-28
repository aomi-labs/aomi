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

// This client registration is bound to the Agent REST resource.
// Agent calls can also acquire its grant lazily.
await aomi.auth.login({ for: "agent" });
console.log(await aomi.auth.status());
await aomi.auth.logout();
```

Agent REST uses the exact OAuth resource `https://<portal>/v1/agent`; Pipeline
REST uses `https://<portal>/v1/pipeline`. Use a separately registered client
for each resource; one device client cannot request both audiences. A host that already owns token
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

`Aomi` is the product-oriented facade. Pipeline carries a portable Build
without a conversation; Agent owns its session and turn lifecycle. Supplying
`wallet` once exposes `aomi.wallet`, derives canonical `UserState`, and
configures durable Commit execution and legacy Action handling from primitive
wallet capabilities.

```ts
import { Aomi } from "@aomi-labs/client";

const aomi = new Aomi({
  baseUrl: "https://api.aomi.dev",
  wallet: {
    evm: {
      address,
      chainId: 1,
      sendCalls: ({ chainId, calls }) => wallet.sendCalls({ chainId, calls }),
      signTransaction: (payload) => wallet.signTransaction(payload),
      broadcastTransaction: (bytes, chainId) =>
        wallet.broadcastTransaction(bytes, chainId),
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
// Commit is always explicit. On EVM it prepares a durable execution group
// (status "committed", provider_invoked: false); nothing is sent yet.
const preparation = await build.commit();
if ("commits" in preparation) {
  const commits = aomi.pipeline.evm.commits(preparation);
  for (const view of commits.all()) {
    if (commits.canExecute(view)) await commits.execute(view.commit_id);
  }
  commits.close();
}

const agentResult = await aomi.agent.run("Supply 100 USDC to Aave");
console.log(agentResult.messages);
console.log(agentResult.commits); // durable CommitView snapshots

// The wire-close client is always available without a second instance.
await aomi.raw.pipeline.root();
```

Agent runs use **Auto** routing by default. Select **Direct** only when the
caller intentionally pins a turn to one app:

```ts
await aomi.agent.run("Summarize this market", {
  target: { mode: "direct", app: "polymarket" },
});

await aomi.agent.run("Use our hosted research agent", {
  target: { mode: "direct", applicationId: 2936682 },
});
```

Signed-in clients can manage installed apps and per-user app credentials by
canonical application ID. Credential responses contain configuration status
only; saved values are never returned. OAuth clients use the `/v1/account`
resource with separate `account:apps:read`, `account:apps:write`,
`account:credentials:read`, and `account:credentials:write` scopes. Credential
read access reveals setup status only, never saved values.

```ts
const catalog = await client.listAccountApps(sessionId);
const app = catalog.find((entry) => entry.name === "credential-demo")!;

await client.setAppCredential(
  sessionId,
  app.applicationId!,
  "DEMO_API_TOKEN",
  token,
);
await client.addAccountApp(sessionId, app.applicationId!);

const status = await client.getAppCredentialsStatus(
  sessionId,
  app.applicationId!,
);
await client.replaceAppCredential(
  sessionId,
  app.applicationId!,
  "DEMO_API_TOKEN",
  rotatedToken,
);
await client.removeAppCredential(
  sessionId,
  app.applicationId!,
  "DEMO_API_TOKEN",
);
await client.removeAccountApp(sessionId, app.applicationId!);
```

For event-driven Agent integrations, retain the run object:

```ts
const run = aomi.agent.run("Swap half my USDC and supply the rest");
run.on("commit", (commit) => {
  // Review the prepared intent before invoking the connected wallet.
  renderCommit(commit);
});
run.on("action", async (action) => {
  // Historical and off-chain requests still use Actions.
  renderAction(action);
  if (await showApprovalUI(action)) {
    await run.session.actions.execute(action.id);
  } else {
    await run.reject(action.id, "User rejected");
  }
});
run.on("completed", console.log);
const result = await run.result();
const session = await aomi.agent.openSession(result.sessionId);
try {
  for (const commit of session.commits.all()) {
    if (commit.action && session.commits.canExecute(commit)) {
      const review = session.commits.review(commit.commit_id);
      if (await showCommitApprovalUI(commit, review)) {
        await session.commits.execute(commit.commit_id);
      } else {
        await session.commits.reject(commit.commit_id);
      }
    }
  }
} finally {
  session.close();
}
```

`AgentRun` emits each increasing commit version once; `result.commits` is its
last snapshot. `openSession` fetches the authoritative session state after a
reconnect. The caller owns and closes that hydrated session. Pass explicit
`commits` capabilities to `new Aomi({ commits })` or per run when a host owns
signing or broadcast separately from `wallet`.

Wallet operations are capability based. The SDK only invokes a method the
adapter supplies, and the Commit service verifies signatures and transitions:

| Prepared work              | Wallet capability                                                                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EVM transaction Commit     | `evm.signTransaction` signs the prepared nonce, gas, fees, value, and call; `evm.broadcastTransaction` submits signed bytes when the broadcaster is Wallet.                                     |
| EVM browser send           | `evm.preparePreparedTransaction` and `evm.sendPreparedTransaction`, with a durable `CommitRecoveryStore`, record a wallet attempt before submission.                                            |
| EVM user operation         | `evm.signMessage` signs the owner request; Commit Service submits the operation.                                                                                                                |
| SVM transaction Commit     | `svm.signTransaction` signs the prepared base64 transaction; `svm.broadcastTransaction` submits when the broadcaster is Wallet. Venue submission needs an explicit `venueBroadcast` capability. |
| Off-chain signature Action | `evm.signMessage`, `evm.signTypedData`, or `svm.signMessage`, according to the request.                                                                                                         |

SIWE/SIWS login proves account ownership; it does not provide the SDK with a
transaction signing callback. Supply the matching wallet adapter separately.
An unattended run without a reachable signer can retain a pending Commit for a
later connected client.

For a signed-in EVM process, the public `createSiweAccountAuthAdapter` and
`createAccountSessionProvider` provide a required account session to `Aomi`.
The adapter signs the Portal's textual SIWE challenge; the wallet separately
signs reviewed Commit or Action payloads. The runnable
[`wallet-terminal`](../../apps/examples/headless-client/src/wallet-terminal.ts)
shows both paths with `AOMI_WALLET_AUTH=siwe` and keeps its session token in
memory.

### Low-level Pipeline API

`AomiClient` stays close to the stateless public protocol. Stable EVM and SVM
primitives have distinct DTOs and lifecycle transitions; TypeScript rejects a
commit of a merely staged Build.

Build V2 values retain the server's native action records, `origin`, `expiresAt`,
`digest`, and `attestation`. Pass the complete value through simulate/commit;
do not reconstruct it from displayed calls. Commit never executes a wallet
request itself, and an expired Build requires fresh preparation.

- **EVM** commit prepares or recovers a durable execution group. It returns
  `status: "committed"` with `provider_invoked: false`, the owned `thread_id`,
  the original `actions` and the Commit Service `commits`. Pass the result to
  `aomi.pipeline.evm.commits(preparation)` to get a `CommitController`, then
  `execute`, `reject` or `refresh` each returned `commit_id` through
  `/v1/pipeline/evm/commits/{id}`. Do not send the returned `requests` to a
  wallet directly.
- **SVM** commit is stateless. It returns `results` plus `requests` with no
  durable Agent Action IDs; the caller submits them and tracks receipts.

The direct staging helpers translate calls into Catalog staging parameters.
Pipeline chooses the authorizing account from account policy: a caller `from`
override is rejected. SVM cluster/payer overrides and non-base64 instruction
data are currently unsupported and rejected rather than ignored.

```ts
const staged = await client.pipeline.evm.stage({
  actions: [
    {
      to: "0x...",
      chain_id: 1,
      description: "Transfer",
      data: { signature: "", args: [], raw: "0x" },
      value: 0n,
    },
  ],
});
const simulated = await client.pipeline.evm.simulate(staged);
const committed = await client.pipeline.evm.commit(simulated);

const svmStaged = await client.pipeline.svm.stage({
  kind: "instructions",
  instructions: [
    {
      description: "Transfer",
      instructions: [{ program_id: "...", accounts: [], data_base64: "..." }],
    },
  ],
});
```

Portable builds preserve backend transaction records and operation provenance.
Commit returns `requests` (`ActionRequest[]`), plus operation output in
`result` (EVM) or `results` (SVM). The SDK never signs them automatically.
Continue EVM results through `commits()` as above; SVM requests have no
durable Agent Action IDs.

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

Owns authenticated streaming, ordered Event reduction, durable Commit execution,
and legacy Action execution.

```ts
import { Session, commitCapabilities } from "@aomi-labs/client";

const session = new Session(
  { baseUrl: "https://api.aomi.dev" },
  {
    actions: walletCapabilities,
    commits: commitCapabilities(wallets),
  },
);

// Blocking send — receives streamed updates until the agent finishes responding
const result = await session.send("Swap 1 ETH for USDC on Uniswap");
console.log(result.messages);

const unsubscribe = session.subscribe(() => {
  const { actions, commits, turnState } = session.getSnapshot();
  console.log(turnState, actions, commits);
});

await session.commits.execute(commitId);
await session.actions.execute(actionId);
unsubscribe();
session.close();
```

To pin a session to one app, pass a typed Direct target:

```ts
const directSession = new Session(client, {
  target: { mode: "direct", app: "uniswap" },
});
```

### Session API

#### Constructor

```ts
new Session(clientOptions: AomiClientOptions, sessionOptions?: SessionOptions)
// or pass an existing AomiClient instance:
new Session(client: AomiClient, sessionOptions?: SessionOptions)
```

| Option         | Default               | Description                                             |
| -------------- | --------------------- | ------------------------------------------------------- |
| `sessionId`    | `crypto.randomUUID()` | Agent session ID                                        |
| `target`       | `{ mode: "auto" }`    | Auto, or a Direct `app` / hosted `applicationId` target |
| `model`        | —                     | Optional model preference                               |
| `getUserState` | —                     | Reads canonical UserState when a turn starts            |
| `actions`      | `{}`                  | Legacy wallet Action capabilities                       |
| `commits`      | `{}`                  | Durable signing, broadcast, and recovery capabilities   |
| `logger`       | —                     | Pass `console` for debug output                         |

Legacy `app` and `applicationId` options still imply Direct for compatibility;
new integrations should use `target` so routing intent is unambiguous.

#### Methods

| Method                | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `send(message)`       | Send a message, wait for completion, return `{ messages, title }` |
| `sendAsync(message)`  | Send without waiting — stream in background, listen via events    |
| `interrupt()`         | Cancel current processing                                         |
| `sync()`              | Fetch the next ordered EventPage                                  |
| `fetchCurrentState()` | Hydrate from the session Event ledger                             |
| `getSnapshot()`       | Immutable SessionSnapshot                                         |
| `subscribe(listener)` | Subscribe for `useSyncExternalStore`                              |
| `startStreaming()`    | Start or resume live delivery                                     |
| `stopStreaming()`     | Stop the current stream and scheduled reconnect                   |
| `close()`             | Stop streaming and release listeners                              |

To reconsider a completed assistant answer, pass `{ regenerate: messageKey }` as the second argument to `send` or `sendAsync`. The key must identify a completed assistant message in the same session. The server appends a new answer with all tools disabled; it preserves the original conversation and transaction outcomes.

#### Snapshot

```ts
const unsubscribe = session.subscribe(() => {
  const snapshot = session.getSnapshot();
  console.log(snapshot.cursor, snapshot.turnState, snapshot.commits);
});

await session.commits.execute(commitId);
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

For a key held by the CLI, native SIWE and SIWS sign-in use the Portal's
nonce/verify endpoints and associate the signed address with the account:

```bash
aomi account login --wallet --private-key "$PRIVATE_KEY"     # EVM SIWE
aomi account login --solana --solana-private-key "$SOLANA_PRIVATE_KEY" # SVM SIWS
aomi account whoami
```

The EVM flow is implemented in `signInWithCliSiwe` in the package's CLI auth
module. It signs the server-provided challenge with Viem, then verifies it
with the Portal. Neither login option grants delegated server signing.

Claude Code / Codex skills that drive this CLI live in the separate
[`aomi-labs/skills`](https://github.com/aomi-labs/skills) repository — that
repo is the single source of truth for skill content.

```bash
npx @aomi-labs/client --version                         # print installed CLI version
npx @aomi-labs/client                                    # start the interactive REPL
npx @aomi-labs/client --prompt "swap 1 ETH for USDC"    # one-shot prompt mode
npx @aomi-labs/client chat "swap 1 ETH for USDC"        # explicit chat subcommand
npx @aomi-labs/client chat "compare lending rates" --mode auto
npx @aomi-labs/client chat "quote this swap" --mode direct --app uniswap
npx @aomi-labs/client chat "swap 1 ETH for USDC" --model claude-sonnet-4
npx @aomi-labs/client chat "swap 1 ETH" --verbose        # stream tool calls + responses live
npx @aomi-labs/client --provider-key anthropic:sk-ant-... --prompt "hello"
npx @aomi-labs/client app list                           # account catalog + install status
npx @aomi-labs/client app available                      # executable Pipeline apps
npx @aomi-labs/client app add <name-or-id>               # install an account app
npx @aomi-labs/client app remove <name-or-id>            # uninstall an account app
npx @aomi-labs/client app credentials status <app>       # redacted setup status
printf %s "$TOKEN" | npx @aomi-labs/client app credentials set <app> <name>
npx @aomi-labs/client app credentials replace <app> <name> # silent prompt
npx @aomi-labs/client app credentials remove <app> <name>
npx @aomi-labs/client model list                         # list available models
npx @aomi-labs/client model set claude-sonnet-4          # switch the current session model
npx @aomi-labs/client session new                        # create a fresh active session
npx @aomi-labs/client secret list                        # list configured secret handles
npx @aomi-labs/client secret add ALCHEMY_API_KEY=...     # ingest a secret for the active session
npx @aomi-labs/client session log                        # show full conversation history
npx @aomi-labs/client tx list                            # list commits and legacy Actions
npx @aomi-labs/client tx simulate action-1               # simulate a legacy EVM Action
npx @aomi-labs/client tx export action-1 > execution.json # canonical EIP-5792
npx @aomi-labs/client tx export action-1 --format moss   # MOSS call array
npx @aomi-labs/client tx export action-1 --format metamask # MetaMask handoff
npx @aomi-labs/client tx sign <commit-id>                # execute a reviewed commit
npx @aomi-labs/client tx export <commit-id> --format commit > commit.json
npx @aomi-labs/client tx submit <commit-id> --signed-file signed.json
npx @aomi-labs/client tx reject <commit-id>              # reject a commit
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

Credential `set` and `replace` never accept a value argument. They read from a
silent terminal prompt or stdin, and the CLI does not store the value in its
local session state.

The root command now mirrors the Rust CLI shape:

- `aomi` starts an interactive REPL with `/mode`, `/app`, `/model`, `/key`, and `:exit`.
- `/mode auto` restores automatic routing; `/mode direct <app>` pins one app.
- `/app <name>` remains shorthand for `/mode direct <name>`.
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

Current transaction tools create durable Commits. A CommitView identifies the
prepared signer, chain, broadcaster, state, review, and next action. The CLI
refreshes that view before signing, so a successful `commit_id` is a handle for
review and completion, not a transaction hash:

```bash
aomi chat "swap 1 ETH for USDC on Uniswap" --public-key 0xYourAddr --chain 1
aomi tx list
aomi tx sign <commit-id> --private-key "$PRIVATE_KEY"
aomi tx list
```

`tx sign` accepts a pending Commit or a historical Action ID. For a Commit it
executes the backend's current `sign` or `broadcast` step through the matching
wallet capability and reports the returned Commit state. `tx reject` records
the user's refusal on a pending Commit. `tx simulate` is a legacy Action
utility. `tx export <commit-id> --format commit` emits an exact
`aomi.commit.v1` CommitView for an external signer; the signer adds a
`payloads` array of signed bytes without changing that CommitView, then runs
`tx submit <commit-id> --signed-file signed.json`. The CLI checks that the
review, version, and exported view still match before it submits the signed
payload. An already broadcast prepared transaction can instead be reported
with `tx submit <commit-id> --tx-hash <prepared-hash>`; this command does not
broadcast. Legacy EIP-5792/MOSS/MetaMask exports still accept only Actions.

#### Historical Action export

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

**EIP-712 signing** remains supported for historical and off-chain Actions.
When such an Action requests typed data, `aomi tx sign` routes it through the
configured local EVM wallet and submits the result to the backend:

```
$ npx @aomi-labs/client tx list
⏳ action-2  EVM signature  (pending, revision 1)

$ npx @aomi-labs/client tx sign action-2 --private-key 0xac0974...
⏳ action-2  EVM signature  (pending, revision 1)
✅ action-2 completed
```

Account abstraction is decided by backend application policy, never by the
CLI. A current AA Commit carries an owner signature request in its `sign`
action; the local key signs the exact request and Commit Service submits the
operation. Historical AA Actions still use their original route. `--aa` and
`--eoa` are assertions about the prepared work; see "Signing modes" below.

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

| Flag                   | Env Variable          | Default                 | Description                                   |
| ---------------------- | --------------------- | ----------------------- | --------------------------------------------- |
| `--backend-url`        | `AOMI_BACKEND_URL`    | `https://chat.aomi.dev` | Aomi API/BFF URL                              |
| `--api-key`            | `AOMI_API_KEY`        | —                       | API key for non-default apps                  |
| `--mode`               | `AOMI_AGENT_MODE`     | `auto`                  | Agent routing mode (`auto` or `direct`)       |
| `--app`                | `AOMI_APP`            | —                       | Direct app (also implies Direct when omitted) |
| `--application-id`     | `AOMI_APPLICATION_ID` | —                       | Direct hosted application identity            |
| `--model`              | `AOMI_MODEL`          | —                       | Model rig to apply before chat                |
| `--prompt`, `-p`       | —                     | —                       | Send a single prompt and exit                 |
| `--show-tool`          | —                     | —                       | Show tool output in root prompt/REPL mode     |
| `--provider-key`       | —                     | —                       | Save a BYOK provider key as `PROVIDER:KEY`    |
| `--public-key`         | `AOMI_PUBLIC_KEY`     | —                       | EVM wallet address (0x-prefixed)              |
| `--private-key`        | `PRIVATE_KEY`         | —                       | Hex private key for `aomi tx sign`            |
| `--solana-private-key` | `SOLANA_PRIVATE_KEY`  | —                       | Solana keypair (base58 or JSON byte array)    |
| `--cluster`            | `AOMI_SOLANA_CLUSTER` | `mainnet-beta`          | Solana cluster (also CAIP-2 `solana:...`)     |
| `--rpc-url`            | `CHAIN_RPC_URL`       | —                       | RPC URL for transaction submission            |
| `--chain`              | `AOMI_CHAIN_ID`       | `1`                     | Chain ID (1, 137, 42161, 8453, 10, 11155111)  |
| `--json`               | —                     | —                       | Machine-readable JSON where supported         |
| `--verbose`, `-v`      | —                     | —                       | Stream tool calls and agent responses live    |
| `--version`, `-V`      | —                     | —                       | Print the installed CLI version               |

```bash
# Use a custom backend
npx @aomi-labs/client chat "hello" --backend-url https://my-backend.example.com

# Full signing flow with all flags
npx @aomi-labs/client chat "send 0.1 ETH to vitalik.eth" \
  --public-key 0xYourAddress \
  --api-key sk-abc123 \
  --app my-agent \
  --model claude-sonnet-4
npx @aomi-labs/client tx sign <commit-id> \
  --private-key 0xYourPrivateKey \
  --rpc-url https://eth.llamarpc.com
```

### Signing modes

The flags are assertions about already-prepared work, not routing
overrides. The backend chose the route (Wallet, Hosted, or Venue submission;
ordinary transaction or AA) from the account's signing policy and the
application's execution policy before the Commit or Action reached you.

- Default: execute the prepared Commit or historical Action as-is.
- `--aa`: require a backend-prepared AA owner authorization; anything else is
  rejected before signing.
- `--eoa`: reject AA owner authorization; ordinary EVM executions, permits,
  and Solana work pass through unchanged.
- `--aa-provider` / `--aa-mode` are rejected: the AA provider and account
  implementation belong to backend application policy.

### How state works

The CLI is **not** a long-running process — each command starts, runs, and
exits. Conversation history lives on the backend. Between invocations, the CLI
persists local state under `AOMI_STATE_DIR` or `~/.aomi` by default:

| Field           | Purpose                                                |
| --------------- | ------------------------------------------------------ |
| `sessionId`     | Which conversation to continue                         |
| `clientId`      | Stable client identity used for session secret handles |
| `agentMode`     | Auto or Direct routing for the active session          |
| `app`           | Direct app, when Direct is selected                    |
| `applicationId` | Direct hosted app identity, when selected              |
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
$ npx @aomi-labs/client chat "swap 1 ETH"      # reuses the Agent session and may create a Commit
$ npx @aomi-labs/client tx list                 # refreshes Commits and legacy Actions
$ npx @aomi-labs/client tx sign <commit-id>     # executes the next reviewed Commit step
$ npx @aomi-labs/client session close           # clears the active local session pointer
```

Session files live under `~/.aomi/sessions/` by default, with an active session
pointer stored in the state root.
