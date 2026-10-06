# Headless TypeScript client

Runnable, framework-free examples for calling Aomi from a CLI, server, or
automation process. Start from the row that matches the API and identity model
you need.

## Quick start

Install workspace dependencies and execute an example from the repository
root. The guest, OAuth, and walkthrough examples call production
(`https://chat.aomi.dev`) unless `AOMI_BASE_URL` says otherwise; the wallet,
SIWS, and credit examples sign with throwaway keys and keep a local default.

```sh
pnpm example:agent:guest
# Against a local Portal/API stack instead:
AOMI_BASE_URL=http://localhost:3000 pnpm example:agent:guest
```

No key is needed: guest access is the default. You only need an OAuth client
ID for signed-in device login (below), and an App key only when targeting a
private App (ask its owner).

Guest authentication is automatic. The first request creates a Better Auth
anonymous session, and the Node client retains its official session cookie in
memory for the life of the client.

Agent routing is also automatic by default. Omit `target` for Auto, or pin a
specific integration with
`target: { mode: "direct", app: "your-app" }`. Legacy `app` and
`applicationId` options still imply Direct, but new code should use `target`.

## Pick an authentication path

| Path            | Use it when                                           | Example                                                                                             |
| --------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Guest           | The operation is available without an account         | [`src/agent/guest.ts`](./src/agent/guest.ts) and [`src/pipeline/guest.ts`](./src/pipeline/guest.ts) |
| OAuth           | A user authorizes a CLI, bot, or server process       | [`src/oauth/device.ts`](./src/oauth/device.ts) · `pnpm example:oauth`                               |
| Account credits | A signed-in process reads or purchases durable credit | [`src/account/credits.ts`](./src/account/credits.ts) · `pnpm example:account:credits`               |

The OAuth example uses a provisioned public client and device login—never a
client secret. Device clients are bound to one exact REST resource. The example
uses Agent by default; set `AOMI_OAUTH_RESOURCE` to the Portal's exact
`/v1/pipeline` resource and use a separately registered Pipeline client to
read that catalog. Register a public device client once (see
[Register an OAuth client](../../../packages/client/README.md#register-an-oauth-client))
and set its ID before running the example:

```sh
AOMI_OAUTH_CLIENT_ID=<client_id from registration> \
pnpm example:oauth
```

The user approves the device once. The example stores rotating refresh grants
in `~/.config/aomi/oauth-grants.json` with owner-only permissions, so future
starts refresh silently until access is revoked or expires. Override the path
with `AOMI_OAUTH_STORE_PATH`.

Each Agent or Pipeline client receives a separate least-privilege grant.
Calling `aomi.auth.login()` at startup is optional—normal API calls also
authenticate lazily.

### Use a secret manager in production

The SDK accepts an `AomiOAuthGrantStore`, so a deployed bot can use its existing
secret manager, encrypted database, or OS keychain. The example includes a
vendor-neutral adapter:

```ts
const store = createSecretGrantStore({
  read: () => secrets.read("aomi-oauth-grants"),
  write: (value) =>
    value
      ? secrets.write("aomi-oauth-grants", value)
      : secrets.remove("aomi-oauth-grants"),
});

const aomi = new Aomi({
  baseUrl,
  auth: oauth({ clientId, store, onVerification }),
});
```

Treat the stored value like a password: it contains rotating refresh tokens.
Do not commit the local file or print the snapshot. Browser OAuth uses
non-exportable DPoP keys and intentionally remains memory-only.

## Other useful examples

- [`src/walkthrough.ts`](./src/walkthrough.ts) is a guided end-to-end guest
  tour: two Agent turns, session management, account state, Pipeline catalog
  discovery when guest access is enabled, and an optional build/simulate flow.
  Run it with `pnpm example:walkthrough`. It never commits a Pipeline operation.
- [`src/oauth/supplied-token.ts`](./src/oauth/supplied-token.ts) is the advanced
  escape hatch for a host that already owns OAuth. It accepts an
  exact-resource access token from a host-owned secure broker. Run it with
  `pnpm example:oauth-token` after setting `AOMI_OAUTH_ACCESS_TOKEN`,
  `AOMI_OAUTH_RESOURCE`, and matching scopes.
- [`src/wallet-terminal.ts`](./src/wallet-terminal.ts) adds a local Viem wallet
  adapter and requires terminal approval for each durable Commit step or
  historical Action. Run it with `pnpm example:wallet-terminal`. The Viem
  adapter signs the backend's prepared EVM transaction bytes, personal messages,
  and typed data; Commit Service verifies and tracks the result. Set
  `AOMI_WALLET_AUTH=siwe` to sign into the same account through the SDK's public
  SIWE challenge adapter before starting Agent turns.
- [`src/custom-contract/anchor-root.ts`](./src/custom-contract/anchor-root.ts)
  uses Aomi as an execution layer for your own contract. The agent builds and
  simulates `registerRoot(bytes32)` on an anchor registry you deployed; the
  script checks the request with `ExpectedCalls` (contract, function, root,
  zero value, passed simulation), rejects any mismatch, and only then signs
  with a local Viem key. See [Custom contract calls](#custom-contract-calls).
- [`../web-sign`](../web-sign) is the browser version of the wallet terminal: a
  Vite + React page that connects the visitor's injected wallet, streams Agent
  replies, reviews and verifies each transaction, and signs with viem. Run it
  with `pnpm example:web-sign`.
- [`src/auth/siws-disposable.ts`](./src/auth/siws-disposable.ts) generates an
  unfunded, in-memory Solana keypair, completes the public SIWS challenge, and
  reads the Agent session list. Run `pnpm example:auth:siws:disposable`; it
  creates no Solana transaction and never prints the secret or session token.
- [`src/account/credits.ts`](./src/account/credits.ts) reads the monthly
  allowance, Credit Bank balance, debt, and recent activity.
  Set `AOMI_TOP_UP_CREDITS` to purchase credits through the SDK's normal x402
  wallet path. The account bearer and private key are read from the environment
  and are never printed or persisted by the example.

## Account credits

The high-level SDK keeps billing under the account it belongs to:

```ts
const position = await aomi.account.credits.get({ limit: 25 });
const topUp = await aomi.account.credits.topUp({
  credits: 100,
  idempotencyKey: crypto.randomUUID(),
});
```

There is no separate debt-payment endpoint. The Credit Bank position reports
any outstanding usage debt, while paid Agent and Pipeline requests satisfy an
x402 challenge automatically through the same wallet transport. A top-up
creates a durable balance for subsequent usage.

For the runnable top-up example, use a short-lived signed-in account bearer and
a funded throwaway EVM development wallet:

```sh
AOMI_BASE_URL=http://localhost:3000 \
AOMI_ACCOUNT_BEARER="$AOMI_ACCOUNT_BEARER" \
AOMI_PRIVATE_KEY="$AOMI_PRIVATE_KEY" \
AOMI_TOP_UP_CREDITS=100 \
AOMI_PAYMENT_CHAIN_ID=84532 \
pnpm example:account:credits
```

## Optional Pipeline walkthrough

The guided walkthrough can build and simulate one catalog operation when all
three inputs are present:

```sh
AOMI_PIPELINE_APP=aave \
AOMI_PIPELINE_OPERATION=supply \
AOMI_PIPELINE_ARGS='{"asset":"USDC","amount":"100"}' \
pnpm example:walkthrough
```

Simulation is the final step. The example deliberately has no `commit()` call.
Some deployments disable guest Pipeline access. In that case the walkthrough
reports that its Pipeline section was skipped; run the OAuth example with an
authorized account to inspect that deployment's catalog. The standalone
`pipeline:guest` example exits with an `insufficient_scope` explanation.

## Optional local wallet

Use a funded throwaway development key on the configured chain:

```sh
AOMI_PRIVATE_KEY=0xYOUR_DEVELOPMENT_PRIVATE_KEY \
EVM_CHAIN_ID=31337 \
EVM_RPC_URL=http://127.0.0.1:8545 \
pnpm example:wallet-terminal
```

To use the SDK's SIWE account session for both Agent turns and Commit requests,
add `AOMI_WALLET_AUTH=siwe` to the same command. The public
`createSiweAccountAuthAdapter` signs the Portal's challenge as text, and
`createAccountSessionProvider` supplies its short-lived widget session token.
The example supplies its Portal Origin on headless requests because widget
sessions are origin bound. No session token is written to disk.

Guest identity and wallet authority remain separate. The anonymous session
identifies the API caller; the wallet handles only the specific reviewed work
the user approves. The example prints each CommitView and its available review,
then reopens the durable session before wallet execution. The private key never
leaves the host process. A browser integration should use its injected or
embedded wallet client instead of a private key.

The package CLI also implements native SIWE/SIWS challenge and verification.
Use `aomi account login --wallet` with an EVM signer or
`aomi account login --solana` with a Solana signer; then `aomi account whoami`
verifies the account. The terminal example uses its own SDK session and never
borrows the CLI's stored login.

## Custom contract calls

`anchor-root` needs a contract you control. Any contract exposing
`function registerRoot(bytes32 root)` works, for example:

```solidity
contract AnchorRegistry {
    event RootRegistered(address indexed by, bytes32 root);
    function registerRoot(bytes32 root) external {
        emit RootRegistered(msg.sender, root);
    }
}
```

Deploy it to a chain the Aomi deployment can simulate on, such as the local
Anvil fork used by `wallet-terminal`, then run:

```sh
AOMI_PRIVATE_KEY=0xYOUR_DEVELOPMENT_PRIVATE_KEY \
EVM_CHAIN_ID=31337 \
EVM_RPC_URL=http://127.0.0.1:8545 \
ANCHOR_REGISTRY_ADDRESS=0xYOUR_DEPLOYED_REGISTRY \
ANCHOR_ROOT=0xYOUR_32_BYTE_MERKLE_ROOT \
pnpm example:custom-contract:anchor-root
```

`ANCHOR_ROOT` is optional; without it the script registers a fresh demo hash.
The expectation is checked twice: against the Commit review (which carries the
simulation result) before `commits.execute`, and against the exact prepared
transaction inside the wallet's `signTransaction`. A mismatch rejects the
Commit and exits non-zero. Whether the agent builds the call depends on the
deployment's model and tools; the script reports the agent's reply when no
transaction was prepared.

## Validation inventory

Run these from the repository root with the pinned workspace pnpm. Each row
names only the environment variables the example reads. A passing request
proves its stated slice of the flow; it does not imply a wallet transaction
was submitted.

| Command                                             | Variables                                                                                                                       | Expected evidence                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `corepack pnpm example:agent:guest`                 | `AOMI_BASE_URL`                                                                                                                 | A guest Agent session ID and one agent reply.                                                                                                           |
| `corepack pnpm example:pipeline:guest`              | `AOMI_BASE_URL`                                                                                                                 | Guest-visible app and skill counts when the deployment enables guest Pipeline; otherwise an explicit 403 access error.                                  |
| `corepack pnpm example:walkthrough`                 | `AOMI_BASE_URL`; optionally `AOMI_PIPELINE_APP`, `AOMI_PIPELINE_OPERATION`, `AOMI_PIPELINE_ARGS`                                | Two turns reuse one session; optional Pipeline section reports access policy and never commits.                                                         |
| `corepack pnpm example:oauth`                       | `AOMI_BASE_URL`, `AOMI_OAUTH_CLIENT_ID`; optionally `AOMI_OAUTH_RESOURCE`, `AOMI_OAUTH_STORE_PATH`                              | Device authorization and an authenticated Agent or Pipeline request, matching the client's exact resource. Requires browser approval.                   |
| `corepack pnpm example:oauth-token`                 | `AOMI_BASE_URL`, `AOMI_OAUTH_ACCESS_TOKEN`, `AOMI_OAUTH_RESOURCE`, `AOMI_OAUTH_SCOPES`                                          | A host-supplied exact-resource token is accepted for the requested scope.                                                                               |
| `corepack pnpm example:account:credits`             | `AOMI_BASE_URL`, `AOMI_ACCOUNT_BEARER`, `AOMI_PRIVATE_KEY`; optionally `AOMI_TOP_UP_CREDITS`, `AOMI_PAYMENT_CHAIN_ID`           | Reads Credit Bank position; setting top-up credits adds a paid operation.                                                                               |
| `corepack pnpm example:wallet-terminal`             | `AOMI_BASE_URL`; for EVM wallet work also `AOMI_PRIVATE_KEY`, `EVM_CHAIN_ID`, `EVM_RPC_URL`; optionally `AOMI_WALLET_AUTH=siwe` | Guest or signed-in SIWE Agent session, with terminal approval for every pending Commit step or historical Action. `/exit` quits.                        |
| `corepack pnpm example:custom-contract:anchor-root` | `AOMI_BASE_URL`, `AOMI_PRIVATE_KEY`, `EVM_CHAIN_ID`, `EVM_RPC_URL`, `ANCHOR_REGISTRY_ADDRESS`; optionally `ANCHOR_ROOT`         | A Commit whose review decodes to `registerRoot(root)` on the registry with passed simulation, signed locally; mismatches are rejected with exit code 1. |
| `corepack pnpm example:auth:siws:disposable`        | `AOMI_BASE_URL`; optionally `AOMI_SIWS_CHAIN_ID`                                                                                | Disposable-key SIWS challenge/verify and authenticated Agent read; no funded key or Solana transaction.                                                 |

`corepack pnpm --filter @aomi-labs/example-headless-client build` typechecks
every example. `corepack pnpm --filter @aomi-labs/example-headless-client test`
checks OAuth grant storage and local EVM personal-message, EIP-712, and
prepared-transaction signatures with ephemeral test keys and no RPC server.

The browser wallet example in `apps/widget-consumer` covers injected EVM/SVM
wallet integration. This headless terminal adapter currently implements only
EVM; Solana transaction and message signing through the CLI use its separate
`--solana` / `--solana-private-key` path.

## Browser authentication

Headless OAuth uses the device browser only for user approval; the bot never
receives a client secret. SIWE, SIWS, Privy, and Para authentication are
composed by the Aomi wallet kit; see the sibling
[`widget-consumer`](../widget-consumer) example. Cross-origin browser guests
receive an origin-bound widget session; signed-in widgets can exchange that
session through the managed OAuth bootstrap flow.
