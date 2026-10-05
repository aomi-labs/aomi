# Web sign: a browser chat that signs with the user's wallet

One worked example of turning a Node `@aomi-labs/client` prototype into a web
page anyone can use. The page:

1. connects the visitor's injected EVM wallet (`window.ethereum`) through viem;
2. opens an Aomi Agent session from the browser, with no backend of your own;
3. sends prompts and streams the agent's replies;
4. renders each `execute_evm` Action as a readable review: target, value,
   chain, decoded function call, and simulated balance changes;
5. runs a **verify before sign** gate, and enables Approve only when every
   check passes;
6. on Approve, asks the wallet to sign and send, then reports the transaction
   hashes back to the agent. On Reject, it tells the agent that the user
   declined.

Aomi never holds keys. The agent builds and simulates transactions; the
visitor's wallet signs them.

## Run it

Prerequisites: Node 22, pnpm (the version pinned in the repo root), and a
browser with an injected EVM wallet such as MetaMask or Rabby.

```sh
pnpm install
cp apps/examples/web-sign/.env.example apps/examples/web-sign/.env.local
pnpm example:web-sign            # http://localhost:5174
```

Click **Connect wallet**, then ask for something that needs a transaction. For
example: "Send 0.0001 ETH to vitalik.eth on Base". Use a throwaway wallet with
small balances while you experiment.

`pnpm --filter @aomi-labs/example-web-sign build` type-checks the app and
writes a static bundle to `dist/`, which you can host anywhere.

### Environment

| Variable                   | Default                 | Purpose                                                                                        |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `VITE_AOMI_BASE_URL`       | `https://chat.aomi.dev` | Aomi Portal/API origin. Use `http://localhost:3000` for a local Portal.                        |
| `VITE_AOMI_APPLICATION_ID` | _(empty)_               | Pin a hosted App by numeric id. Empty uses default Agent routing, so no App is needed.         |
| `VITE_ALLOWED_TARGETS`     | _(empty)_               | Comma-separated addresses. When set, Approve requires every transaction to target one of them. |

All three values are public build-time configuration. This app has no secrets.

## How it works

| File                                                 | Responsibility                                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`src/injected-wallet.ts`](./src/injected-wallet.ts) | `InjectedWallet` wraps `window.ethereum` in a viem `WalletClient` and adapts it to the SDK's `Wallets` contract. |
| [`src/App.tsx`](./src/App.tsx)                       | Reads configuration, creates the `Aomi` client, and opens one `Session` for each connected account.              |
| [`src/Chat.tsx`](./src/Chat.tsx)                     | Subscribes to the session with `useSyncExternalStore`, renders the transcript, and sends prompts.                |
| [`src/ActionReview.tsx`](./src/ActionReview.tsx)     | Shows the human-readable review, runs the verify-before-sign checks, and approves or rejects the Action.         |

The SDK calls the code below map directly to the Node prototype:

```ts
const aomi = new Aomi({ baseUrl }); // guest auth, no options needed
const wallets = wallet.toAomiWallets(); // viem + window.ethereum
const session = new Session(aomi.raw, {
  actions: walletCapabilities(wallets),
  commits: commitCapabilities(wallets, recoveryStore),
  getUserState: () => walletUserState(wallets),
  // target: { mode: "direct", applicationId }  // only to pin an App
});

session.subscribe(render); // streamed messages and Actions
await session.send("Swap 5 USDC for ETH on Base");

// For each pending Action, after the user reviews it:
await session.actions.execute(action.id); // wallet signs, result goes to the agent
await session.actions.reject(action.id, "Rejected by the user");
```

`aomi.agent.run(prompt)` is the one-shot equivalent used in the Node examples.
A chat page keeps one `Session` open across turns instead. `@aomi-labs/react`
builds on the same `Session` primitive.

`session.actions.execute()` handles both kinds of transaction Action. An
ordinary `execute_evm` Action calls the wallet's `sendTransaction` once per
call, then posts `{ status: "submitted", legs }` back to the agent. A durable
Action (one that carries `commitStages`) goes through the Commit Service:
the SDK records an attempt, calls `sendPreparedTransaction`, and the service
verifies the result on-chain. `LocalCommitRecovery` in `App.tsx` stores the
in-flight attempt, so a reload reconciles a sent transaction instead of
prompting the wallet again.

### Verify before sign

`ActionReview` disables **Approve & sign** unless all of these hold:

- `simulation.status` is `"passed"`;
- every transaction's `from` is the connected wallet;
- every `to` is in `VITE_ALLOWED_TARGETS`, when that variable is set;
- the SDK reports that the connected wallet can execute the request
  (`session.actions.canExecute`). For an ordinary Action, this also requires
  the server's transaction-safety decision, when present, to be eligible.

These checks run in the browser against the exact request that the wallet will
sign. Add your own checks in the same place, such as a maximum value, an
expected chain, or a function-selector allowlist. Calldata is decoded with the
ABI passed to `<Chat abi={...}>` (viem's `erc20Abi` here). Add your contracts'
ABIs to decode their calls by name.

## Why guest auth works from your own domain

The browser talks to the Aomi Portal directly, so authentication has to work
cross-origin. With no `auth` option, `new Aomi({ baseUrl })` signs in as a
guest. When the page's origin differs from `baseUrl`, the SDK calls
`POST /api/auth/widget/guest`. The Portal returns an anonymous **widget
session** bound to the page's `Origin`, and the SDK sends it as
`Authorization: Bearer …` on `/v1/agent` calls. That is the same mechanism the
embeddable Widget uses. No cookies, client secret, or OAuth client
registration are involved, so you do not need a server of your own.

Origin rules enforced by the Portal:

- any `https://` origin is accepted, and so are `http://localhost`,
  `http://127.0.0.1`, and `http://[::1]` for development. Other plain-`http`
  origins, such as a LAN IP, are refused;
- the session works only from the origin that created it;
- anonymous sessions get the guest scope ceiling: read and write the Agent and
  resolve their own Actions. Custody, payments, and account features need a
  signed-in identity.

The guest credential lives only in page memory, so a reload starts a new
anonymous identity and an empty conversation. To keep history or use
account features, sign the user in. The headless examples show SIWE and OAuth
sign-in in [`../headless-client`](../headless-client).

## Choosing a surface

| You want                                                  | Use                                                                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Users chat with Aomi and you write no UI                  | The hosted Portal at [chat.aomi.dev](https://chat.aomi.dev)                                                                |
| Aomi inside your site with minimal code                   | The embeddable Widget ([installation](https://aomi.dev/docs/guides/widget/installation))                                   |
| Your own UI, review screen, or signing policy             | This example: `@aomi-labs/client` in the browser ([headless library](https://aomi.dev/docs/integrate/ui/headless-library)) |
| New tools or protocol integrations available to the agent | Build an App ([Aomi Apps](https://aomi.dev/docs/build/plugins/aomi-app)), then pin it with `VITE_AOMI_APPLICATION_ID`      |

All docs: [aomi.dev/docs](https://aomi.dev/docs).

## Limitations

- EVM only. `execute_svm` and `sign` Actions are shown with a Reject button
  only.
- One wallet prompt per call. Batched `wallet_sendCalls` (EIP-5792) is not
  wired up; add `sendCalls` to `toAomiWallets()` if your users' wallets
  support it.
- Pure Commit Service steps that arrive without a linked Action are not
  rendered. The terminal example [`wallet-terminal.ts`](../headless-client/src/wallet-terminal.ts)
  shows how to review those.
