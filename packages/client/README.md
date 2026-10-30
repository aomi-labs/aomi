# @aomi-labs/client

TypeScript SDK for Aomi: chat with an agent, review its commits, build operations
without a model, and read your account. Works in Node and browsers.

## Install

```sh
pnpm add @aomi-labs/client
```

## Quick start

Guest access is the default. `baseUrl` defaults to `https://chat.aomi.dev`.

```ts
import { Aomi } from "@aomi-labs/client";

const aomi = new Aomi();
const thread = aomi.agent.thread();
const turn = thread.send("Introduce Aomi in one sentence.");
const { reply, commits } = await turn;
console.log(reply);
for (const commit of commits) commit.close();
```

Guest bootstrap calls `POST /api/auth/guest`; Node and cross-origin browsers
keep its bearer in memory. Same-origin browsers can use an existing cookie
session.

## Authentication

Device login shows a URL and code to approve in your browser. The SDK registers
a public client when `clientId` is omitted. Grants stay in memory unless you
supply a store; use an explicit private file path for persistence in Node.

```ts
import { oauth, wallet } from "@aomi-labs/client";
import { fileGrants } from "@aomi-labs/client/node";

const signedIn = new Aomi({
  auth: oauth({
    store: fileGrants("./.private/aomi-grants.json"),
    onCode: ({ url, code }) => console.log(`Open ${url}, code ${code}`),
  }),
});
await signedIn.auth.login();
console.log((await signedIn.agent.thread().send("Hello!")).reply);
```

Keep grant files out of version control. API calls also acquire and refresh
OAuth grants lazily. `auth.status()` reports cached authorization;
`auth.logout()` revokes OAuth grants and clears local state.

For a bot, an EVM key can sign in with SIWE. Authentication and transaction
signing are separate: `auth: wallet(account)` signs the login message;
`signer` supplies the wallet used by `commit.sign()`.

```ts
import { viemSigner } from "@aomi-labs/client/viem";
import { createWalletClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const account = privateKeyToAccount(generatePrivateKey()); // disposable, unfunded
const bot = new Aomi({
  auth: wallet(account, { chainId: sepolia.id }),
  signer: {
    evm: viemSigner(
      createWalletClient({ account, chain: sepolia, transport: http() }),
    ),
  },
});
await bot.auth.login();
```

Install `viem` to use that adapter. A local key signs locally; an injected viem
wallet can send transactions itself. Only sign after reviewing the exact request.

## Turns and streaming

`thread()` creates a conversation; `thread(id)` continues one. `send()` returns
an awaitable `Turn`. Stream finished tool calls with `steps()`, then await the
reply. The facade currently has no reply-text iterator; the
[headless guest example](../../examples/headless/src/agent-guest.ts) shows the
lower-level live-message subscription when text streaming is required.

```ts
import { decode } from "@aomi-labs/client/trace";

const priced = thread.send("Use a tool to get the ETH price in USD.");
for await (const step of priced.steps({ decode })) {
  console.log(
    step.outcome,
    step.title,
    step.chips.map((chip) => chip.label),
  );
}
const priceResult = await priced;
console.log(priceResult.state, priceResult.reply);
for (const commit of priceResult.commits) commit.close();
```

Without `decode`, steps contain `id`, `name`, `args`, and `result`. A turn resolves
as `completed`, `interrupted`, or `awaiting_approval` when commits need a decision.
A failed turn rejects. `turn.interrupt()` stops it, including after a handoff.

## Commits: review, then sign or approve

One `Commit` represents an operation, including transactions or messages on EVM
or Solana. A turn returns its open commits; `aomi.commits.get(ref)` reopens one.
Read the review before deciding. `sign()` uses your signer; `approve()` authorizes
an agent wallet for an `awaiting_approval` commit, subject to account policy.

```ts
async function reviewCommit(ref: string, accept: boolean) {
  const commit = await bot.commits.get(ref);
  try {
    const shown = commit.view;
    console.dir(commit.review, { depth: null });
    if (!accept) await commit.reject();
    else if (shown.state === "awaiting_approval") await commit.approve(shown);
    else await commit.sign();
  } finally {
    commit.close();
  }
}
```

Decide only after showing the review to a person or applying your signing policy.
Changed versions fail with `commit_stale`: refresh and review again before retrying.
If approval is forbidden, show `commit.signUrl`. Handles poll while live; close
ones you no longer use. `commit.next` follows the next member of a sequential
batch; review and sign each member. `commit.settled({ signal })` waits for the
whole batch and rejects if any member fails, expires, or is rejected.

## Pipeline

Discover operations on your deployment with `aomi.pipeline.operations()`, then
build one by name and schema. No app argument is required; the default app is
used. Building stages and simulates, without signing or broadcasting.

```ts
async function prepareOperation(name: string, args: Record<string, unknown>) {
  const build = await bot.pipeline.build(name, args);
  console.log(build.digest, build.expiresAt);
  console.dir(build.balanceChanges);
  console.dir(build.approvals);
  return build;
}
```

After review, an EVM build's `commit()` returns the same Commit handle to sign.
Solana builds simulate but `build.commit()` currently throws
`svm_commit_unavailable`. Use `pipeline.invoke(name, args)` for a read operation,
or `{ app: "name" }` to select an app explicitly.

## Account

```ts
const credits = await bot.account.credits.get();
const apps = await bot.account.apps.list();
const wallets = await bot.account.wallets.list();
console.log(credits.balance_microusd, apps, wallets);

// What a thread said so far, and switching the wallet it trades with.
const { messages, activeWallet } = await bot.agent.thread(thread.id).history();
console.log(messages.at(-1)?.text, activeWallet.evm);
if (wallets[0])
  await bot.account.wallets.use(wallets[0].id, { thread: thread.id });
```

Account methods require a signed-in identity and the relevant permissions. A
thread that has not started yet takes its wallet from the first turn instead
(`userState.wallet_pick`).

## Subpaths

| Import                           | Purpose                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `@aomi-labs/client/viem`         | `viemSigner(walletClient)` for EVM signing                                          |
| `@aomi-labs/client/solana`       | `solanaSigner(keypairOrSecret)`; install `@solana/web3.js`, `bs58`, and `tweetnacl` |
| `@aomi-labs/client/node`         | `fileGrants(path)` for private OAuth grant storage                                  |
| `@aomi-labs/client/trace`        | `decode` and trace utilities, without React                                         |
| `@aomi-labs/client/browser-auth` | Browser account authentication helpers                                              |

## Errors

`AomiError` carries `code`, optional HTTP `status`, and an optional actionable
`hint`. `isAomiError` also recognizes errors across bundled SDK copies and groups
wire-level version conflicts under `commit_stale`. Network errors and invalid
arguments can still be ordinary JavaScript errors.

```ts
import { AomiError, isAomiError } from "@aomi-labs/client";

try {
  await bot.account.credits.get();
} catch (error) {
  if (isAomiError(error)) console.error(error.code, error.status, error.hint);
  else throw error;
}
const exampleError = new AomiError("no_signer");
console.log(exampleError.hint);
```

## Low-level AomiClient

Use `aomi.raw` for wire-close transports or construct `AomiClient` explicitly.
The low-level client requires its connection and credential policy to be set;
it does not provide the facade's default guest bootstrap.

```ts
import { AomiClient } from "@aomi-labs/client";

const raw = new AomiClient({
  baseUrl: "https://chat.aomi.dev",
  guest: false,
  getAccountBearer: async () => "your-server-held-session-token",
});
const page = await raw.agent.sessions.list({ limit: 5 });
console.log(page.sessions);
```

For the command-line tool, see the [CLI README](../cli/README.md).
