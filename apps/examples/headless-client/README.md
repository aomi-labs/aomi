# Headless TypeScript client

Runnable, framework-free examples for calling Aomi from a CLI, server, or
automation process. Start from the row that matches the API and identity model
you need.

## Quick start

Run the local Portal/API stack, install workspace dependencies, and execute an
example from the repository root:

```sh
AOMI_BASE_URL=http://localhost:3000 pnpm example:agent:guest
```

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
client secret. Set the environment-specific public client ID before running it:

```sh
AOMI_OAUTH_CLIENT_ID=your-managed-public-client \
pnpm example:oauth
```

The user approves the device once. The example stores rotating refresh grants
in `~/.config/aomi/oauth-grants.json` with owner-only permissions, so future
starts refresh silently until access is revoked or expires. Override the path
with `AOMI_OAUTH_STORE_PATH`.

Agent and Pipeline still receive separate least-privilege grants internally;
applications only configure OAuth once. Calling `aomi.auth.login()` at startup
is optional—normal API calls also authenticate lazily.

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
  discovery, and an optional build/simulate flow. Run it with
  `pnpm example:walkthrough`. It never commits a Pipeline operation.
- [`src/oauth/supplied-token.ts`](./src/oauth/supplied-token.ts) is the advanced
  escape hatch for a host that already owns OAuth. It accepts an
  exact-resource access token from a host-owned secure broker. Run it with
  `pnpm example:oauth-token` after setting `AOMI_OAUTH_ACCESS_TOKEN`,
  `AOMI_OAUTH_RESOURCE`, and matching scopes.
- [`src/wallet-terminal.ts`](./src/wallet-terminal.ts) adds a local Viem wallet
  adapter and requires manual approval for every Action. Run it with
  `pnpm example:wallet-terminal`.
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

## Optional local wallet

Use a funded throwaway development key on the configured chain:

```sh
AOMI_PRIVATE_KEY=0xYOUR_DEVELOPMENT_PRIVATE_KEY \
EVM_CHAIN_ID=31337 \
EVM_RPC_URL=http://127.0.0.1:8545 \
pnpm example:wallet-terminal
```

Guest identity and wallet authority remain separate. The anonymous session
identifies the API caller; the wallet handles only the specific action the user
approves. The private key never leaves the host process. A browser integration
should use its injected or embedded wallet client instead of a private key.

## Browser authentication

Headless OAuth uses the device browser only for user approval; the bot never
receives a client secret. SIWE, SIWS, Privy, and Para authentication are
composed by the Aomi wallet kit; see the sibling
[`widget-consumer`](../widget-consumer) example. Cross-origin browser guests
receive an origin-bound widget session; signed-in widgets can exchange that
session through the managed OAuth bootstrap flow.
