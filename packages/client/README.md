# @aomi-labs/client

TypeScript client for the Aomi on-chain agent backend. Works in Node.js and browsers.

The production API is `https://api.aomi.dev`; pass it as `baseUrl` (the CLI
uses it by default).

## Which credential do I need?

Most integrations need nothing: start as a guest and add a credential only when
a call asks for one.

| Credential      | When you need it                                                | How to get it                                                                                                                      | How to pass it                                                |
| --------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| None (guest)    | Default. Guest-safe Agent and Pipeline calls.                   | Nothing to do — the SDK creates an anonymous session on the first request.                                                         | Omit `auth`.                                                  |
| OAuth client ID | A user signs in your CLI, bot, or server process (device flow). | Register a public device client once — see [Register an OAuth client](#register-an-oauth-client). No secret.                       | `auth: oauth({ clientId: process.env.AOMI_OAUTH_CLIENT_ID })` |
| App key         | Only for **private** Apps. Public Apps never need one.          | Get it from the App's owner. The Aomi team issues the first key to the owner, who can rotate it with `POST /api/account/app-keys`. | `apiKey` option, CLI `--api-key`, or `AOMI_API_KEY`.          |
| Account bearer  | Account-scoped calls (credits, App keys, linked identities).    | `aomi login`, or your own signed-in session.                                                                               | `getAccountBearer`, CLI `--account-bearer`.                   |

If a call fails because of the App rather than your credentials, the error
`code` says why: `app_not_found` (404), `app_inactive` (409, the owner has not
activated it yet), `app_key_required` (401, private App, no key sent), or
`app_key_not_scoped` (403, the key belongs to a different App). These surface
as `AgentApiError` with `appAccessCode` set.

## Public authorization

With no auth option, `Aomi` creates and reuses an anonymous session for the
guest-safe REST surface. For a signed-in CLI, bot, or server process, configure
OAuth once and let the SDK own exact resources, scopes, refresh, and revocation:

```ts
import { Aomi, oauth } from "@aomi-labs/client";

const aomi = new Aomi({
  baseUrl: "https://api.aomi.dev",
  auth: oauth({
    clientId: process.env.AOMI_OAUTH_CLIENT_ID!,
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

### Register an OAuth client

`oauth()` needs a public client ID. The `aomi` CLI registers one for itself;
for your own integration, register a device client once and keep its
`client_id` (it is not a secret, and there is no client secret):

```bash
curl -sX POST https://api.aomi.dev/api/auth/oauth2/register \
  -H 'content-type: application/json' \
  -d '{
    "client_name": "My Aomi bot",
    "token_endpoint_auth_method": "none",
    "grant_types": ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
    "resources": ["https://api.aomi.dev/v1/agent"],
    "scope": "agent:read agent:write agent:actions:resolve offline_access"
  }'
# => { "client_id": "...", ... }  → export AOMI_OAUTH_CLIENT_ID=<client_id>
```

Registration only accepts public clients (`token_endpoint_auth_method: "none"`)
with exactly the device-code and refresh-token grants, and exactly one REST
resource. For Pipeline, register a second client with resource
`https://api.aomi.dev/v1/pipeline` and scope
`pipeline:catalog pipeline:execute offline_access`.

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
`signer` once exposes `aomi.wallet`, derives canonical `UserState`, and
configures durable Commit execution and legacy Action handling from primitive
wallet capabilities. `viemSigner(walletClient)` (`@aomi-labs/client/viem`) and
`solanaSigner(secretKey)` (`@aomi-labs/client/solana`) build them from a local
key.

```ts
import { Aomi } from "@aomi-labs/client";

const aomi = new Aomi({
  baseUrl: "https://api.aomi.dev",
  signer: {
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
signing or broadcast separately from `signer`.

Wallet operations are capability based. The SDK only invokes a method the
adapter supplies, and the Commit service verifies signatures and transitions:

| Prepared work              | Wallet capability                                                                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EVM transaction Commit     | `evm.signTransaction` signs the prepared nonce, gas, fees, value, and call; `evm.broadcastTransaction` submits signed bytes when the broadcaster is Wallet.                                     |
| EVM browser send           | `evm.preparePreparedTransaction` and `evm.sendPreparedTransaction`, with a durable `CommitRecoveryStore`, record a wallet attempt before submission.                                            |
| SVM transaction Commit     | `svm.signTransaction` signs the prepared base64 transaction; `svm.broadcastTransaction` submits when the broadcaster is Wallet. Venue submission needs an explicit `venueBroadcast` capability. |
| Off-chain signature Action | `evm.signMessage`, `evm.signTypedData`, or `svm.signMessage`, according to the request.                                                                                                         |

A bot or script signs in with its own key: `auth: wallet(signer)` uses SIWE
for an EVM signer (a viem account) and SIWS for a Solana one
(`solanaSigner(...)`), once per process and again after a 401. The session
proves account ownership only; `signer` is what signs the reviewed Commits.

```ts
import { Aomi, wallet } from "@aomi-labs/client";
import { solanaSigner } from "@aomi-labs/client/solana";

const svm = solanaSigner(process.env.SOLANA_SECRET_KEY!, {
  cluster: "solana:devnet",
});
const aomi = new Aomi({
  baseUrl: "https://api.aomi.dev",
  auth: wallet(svm), // SIWS on the signer's cluster
  signer: { svm },
});
```

An unattended run without a reachable signer can retain a pending Commit for a
later connected client.

For a widget-style session instead, `createSiweAccountAuthAdapter` or
`createSiwsAccountAuthAdapter` with `createAccountSessionProvider` provide a
required account session to `Aomi`. The runnable
[`wallet-terminal`](../../examples/headless/src/wallet-terminal.ts) shows the
SIWE path with `AOMI_WALLET_AUTH=siwe`, and
[`solana-build`](../../examples/headless/src/solana-build.ts) the SIWS path
from sign-in to a signed Solana Commit.

Solana clusters are `solana:mainnet`, `solana:devnet` and `solana:testnet`
(`SvmCluster`). `normalizeSolanaCluster` maps the older spellings
(`mainnet-beta`, `solana`, bare names) to these; they are accepted for one
more release.

### Low-level Pipeline API

`AomiClient` stays close to the stateless public protocol. Stable EVM and SVM
primitives have distinct DTOs and lifecycle transitions; TypeScript rejects a
commit of a merely staged Build.

Build V2 values retain the server's native action records, `origin`, `expiresAt`,
`digest`, and `attestation`. Pass the complete value through simulate/commit;
do not reconstruct it from displayed calls. Commit never executes a wallet
request itself, and an expired Build requires fresh preparation.

Commit prepares or recovers a durable execution group on both families. It
returns the owned `thread_id` and the Commit Service `commits`; nothing is
signed or sent yet.

- **EVM** returns `status: "committed"` with `provider_invoked: false` and the
  original `actions`. Pass the result to `aomi.pipeline.evm.commits(preparation)`
  to get a `CommitController`, then `execute`, `reject` or `refresh` each
  returned `commit_id` through `/v1/pipeline/evm/commits/{id}`. Do not send the
  returned `requests` to a wallet directly.
- **SVM** works the same way through `aomi.pipeline.svm.commits(preparation)`.
  A Solana transaction is renewed on a fresh blockhash right before it is
  signed.

`aomi.pipeline.build(name, args)` hides the family: its `commit()` returns a
`CommitHandle` for the first Commit to sign.

The direct staging helpers translate calls into Catalog staging parameters.
Pipeline chooses the authorizing account from account policy: a caller `from`
override is rejected. SVM cluster/payer overrides and non-base64 instruction
data are currently unsupported and rejected rather than ignored.

```ts
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

// Any contract you own; here an anchor registry storing Merkle roots.
const anchorAbi = parseAbi(["function registerRoot(bytes32 root)"]);
const registry: Address = "0xYourAnchorRegistry";
const root: Hex = "0xYour32ByteMerkleRoot";

const staged = await client.pipeline.evm.stage({
  actions: [
    {
      to: registry,
      chain_id: 84532,
      description: "Register Merkle root",
      data: {
        signature: "registerRoot(bytes32)",
        args: [root],
        raw: encodeFunctionData({
          abi: anchorAbi,
          functionName: "registerRoot",
          args: [root],
        }),
      },
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
Commit returns Commit Service `commits` and their `thread_id`, plus operation
output in `result`; EVM also returns its `requests` (`ActionRequest[]`). The
SDK never signs them automatically. Continue either family through
`aomi.pipeline.evm.commits()` or `aomi.pipeline.svm.commits()`, as above.

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

### Verify before you sign

When Aomi is the execution layer for your own contract, decide what you
approve first, then check that every prepared request matches it before a
local key signs. `ExpectedCalls` decodes each transaction's calldata with your
ABI and compares chain, contract, function, arguments (by ABI encoding, so
`bigint` and address or bytes casing compare exactly as the contract sees
them) and value. It also requires simulation to have passed.

```ts
import {
  Aomi,
  CallVerificationError,
  ExpectedCalls,
  type Wallets,
} from "@aomi-labs/client";
import { createPublicClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// `registry` and `root` as in the Pipeline example above.
const baseUrl = process.env.AOMI_BASE_URL ?? "https://api.aomi.dev";
const expected = new ExpectedCalls({
  chainId: baseSepolia.id,
  to: registry,
  abi: parseAbi(["function registerRoot(bytes32 root)"]),
  functionName: "registerRoot",
  args: [root],
  // value omitted: the call must send zero ETH
});

const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
const rpc = createPublicClient({ chain: baseSepolia, transport: http() });
const wallet: Wallets = {
  evm: {
    address: account.address,
    chainId: baseSepolia.id,
    // Commit Service hands the wallet its prepared transaction. Check the
    // exact payload once more before the key touches it.
    signTransaction: async (payload) => {
      expected.assert(payload);
      return account.signTransaction({
        chainId: payload.chain_id,
        type: "eip1559",
        to: payload.transaction.to as Hex,
        data: payload.transaction.data as Hex,
        value: BigInt(payload.transaction.value),
        nonce: payload.nonce,
        gas: BigInt(payload.transaction.gas_limit),
        maxFeePerGas: BigInt(payload.transaction.max_fee_per_gas),
        maxPriorityFeePerGas: BigInt(
          payload.transaction.max_priority_fee_per_gas,
        ),
      });
    },
    broadcastTransaction: (signed) =>
      rpc.sendRawTransaction({ serializedTransaction: signed as Hex }),
  },
};
const aomi = new Aomi({ baseUrl, signer: wallet });

// 1. Intent: name the contract, function, and arguments exactly.
const result = await aomi.agent.run(
  `On Base Sepolia call registerRoot(bytes32) on ${registry} with root ${root}.`,
);

// 2. Aomi built and simulated it; prepared work is a durable Commit whose
//    review is the execute_evm request with its simulation.
const session = await aomi.agent.openSession(result.sessionId);
try {
  for (const commit of session.commits.all()) {
    if (!commit.action || !session.commits.canExecute(commit)) continue;
    try {
      // 3. Verify: throws CallVerificationError listing every mismatch.
      expected.assert(session.commits.review(commit.commit_id));
    } catch (error) {
      if (!(error instanceof CallVerificationError)) throw error;
      await session.commits.reject(commit.commit_id);
      throw error;
    }
    // 4. Sign locally and submit; Commit Service records the outcome and the
    //    agent continues the thread with it.
    const done = await session.commits.execute(commit.commit_id, {
      expectedVersion: commit.version,
      expectedReviewDigest: commit.review?.digest,
    });
    console.log(done.state, done.transaction_url ?? done.transaction_id);
  }
} finally {
  session.close();
}
```

`verify(subject)` returns `{ ok, simulation, calls, mismatches }` instead of
throwing; each mismatch names its `call` index, `field` (`to`, `function`,
`args`, `value`, `chainId`, `simulation`, `count`, `data`, or `request`) and,
for arguments, the `argIndex`. Pass a list to `new ExpectedCalls([...])` for
multi-transaction requests; calls match in order. Omitted `args` and `value`
mean none and zero.

Accepted subjects are an `Action` or its `request` (from `run.on("action")`),
a Commit review (`session.commits.review(id)`), an EVM `sign` request with
declared `calls`, and the single-transaction `SignableCommit` passed to
`evm.signTransaction`. A `SignableCommit` carries no simulation, so check it
against an expectation for that one call after verifying the review. A
simulation of `"unavailable"` is rejected unless you pass
`new ExpectedCalls(calls, { allowUnavailableSimulation: true })`; `"failed"`
is always rejected. The runnable
[`custom-contract/anchor-root`](../../examples/headless/src/custom-contract/anchor-root.ts)
example shows this loop end to end.

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

To edit a request, send the revised text with `{ edit: userMessageKey }`. To rerun an answer, send the original request text with `{ regenerate: assistantMessageKey }`. These options are mutually exclusive. Both replace the conversation from that user message onward and continue it as a normal turn, as in a linear chat. The snapshot echoes the new request immediately and sets `pendingReplacesMessageKey` to the replaced user message until the server's own events arrive. `SessionSnapshot.messages` contains the active conversation; `SessionSnapshot.events` retains the durable ledger. `projectConversationEvents(events)` derives active turns and traces from that ledger.

`interrupt()` immediately publishes `isStopping`, deduplicates pending requests, and keeps receiving partial text until the server acknowledges the actual terminal outcome. Only an interrupted outcome freezes partial text and sets `stoppedTurnId`. If completion or failure wins the race, its answer and status are preserved while final result pages drain. Optional `terminalTurns` retain scoped outcomes across bounded history without changing the audit ledger or cursor. A failed cancellation leaves streaming active and allows retry; a late response for an older turn cannot stop a newer active turn.

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

A start transport failure may occur after admission. `isStartUncertain` remains
true while active work may need reconciliation; Stop recovers its original intent
and idempotency key and never substitutes an unrelated active turn. A different
message is blocked during this uncertainty. Retrying the same message retains
the original operation; failed Stop remains retryable without losing its scope.

When fully drained history has no active work (or the session does not exist),
Stop releases the optimistic running state and restores Send. The original
intent/key remains available for a deliberate same-message retry. Canonical
terminal answers are preserved; matching text does not prove ownership or cause
a new start. Failed or stalled history reads remain retryable.

## CLI

The `aomi` command is its own package, `@aomi-labs/cli`; see its
[README](../cli/README.md). It signs in like the SDK: `aomi login` with a
device code, or headlessly with a key:

```bash
aomi whoami --private-key "$PRIVATE_KEY"                         # EVM, SIWE
aomi whoami --solana-private-key "$SOLANA_KEY" --cluster devnet  # Solana, SIWS
aomi pipeline build supply --app aave '{"asset":"USDC","amount":"100"}' --commit
```


Headless API resources stay on `api.aomi.dev` when the Chat or Build domains change.
Use `https://api.aomi.dev/v1/agent/mcp` for Agent MCP and
`https://api.aomi.dev/v1/pipeline/mcp` for Pipeline MCP. OAuth discovery and
token endpoints are served on the API host itself. Explicitly configured older
Chat endpoints remain supported during migration; obtain a fresh grant when
switching hosts, since OAuth audiences and issuers are not interchangeable.
