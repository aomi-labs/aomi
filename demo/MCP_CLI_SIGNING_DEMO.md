# MCP to CLI external-signing demo

This demo proves that an OAuth-authenticated MCP client can ask Aomi to stage a
transaction while the local Aomi CLI remains the only component allowed to sign
and broadcast it. The MCP endpoint supervises chat and reports status; it never
receives a private key or signing authority.

Use only a dedicated test wallet with enough Base ETH for gas and the service
fee. The demo transaction is a 1 wei self-transfer, so the recipient must be the
same address as the signer.

## Fixed staging values

- Portal origin: `https://chat-staging.aomi.dev`
- MCP endpoint: `https://chat-staging.aomi.dev/api/mcp`
- Direct-tool MCP endpoint: `https://chat-staging.aomi.dev/api/mcp/direct`
- EVM chain: Base (`8453`)
- Required CLI version: `@aomi-labs/client@0.5.1` or a build of this change

Never reuse a previously completed staged ID. In particular, do not retry an
old `tx-1` from another session. Each take should create a new MCP session and
use only the staged IDs returned for that session.

## Prerequisites

1. Node.js 20 or newer and pnpm are installed.
2. The staging wallet is linked to the Aomi account used during OAuth/SIWE.
3. The wallet owns enough Base ETH for gas and the displayed service fee.
4. The private key is available only in a protected local secret file or secret
   manager. Do not paste it into chat, screenshots, shell history, logs, PRs, or
   demo notes.
5. The wallet address is known independently. Confirm that the address derived
   by `aomi wallet set` is the intended test address before signing.

For a checkout of this branch, build and verify the exact CLI artifact:

```bash
pnpm install --frozen-lockfile
pnpm --filter @aomi-labs/client build
node packages/cli/dist/bin.js --version
```

The last command must print `0.5.1`. After the package is published, the
equivalent install is:

```bash
npm install --global @aomi-labs/client@0.5.1
aomi --version
```

Do not run the global-install path until `0.5.1` is actually published.

## Connect from ChatGPT or another OAuth-capable MCP client

For ChatGPT developer-mode testing, follow OpenAI's current
[connect-and-test instructions](https://developers.openai.com/plugins/deploy/connect-chatgpt):

1. In ChatGPT, open **Settings → Security and login** and enable Developer mode.
2. Open ChatGPT Plugins, select the plus button, and create an MCP connection.
3. Enter `https://chat-staging.aomi.dev/api/mcp` as the public HTTPS endpoint.
4. Complete the opened Aomi SIWE sign-in and OAuth consent. Review the discovered
   tools before starting the take.
5. Start a new chat with the connection enabled.

An OAuth-capable Codex-style or other MCP client uses the same endpoint and
standard discovery flow: add the remote streamable-HTTP MCP URL, let the client
discover the protected-resource and authorization metadata, then complete the
opened Aomi SIWE/OAuth flow. Do not copy OAuth tokens, cookies, authorization
codes, or PKCE values between clients.

The primary endpoint should expose `aomi_chat`, `aomi_check`,
`aomi_interrupt`, and `aomi_list_sessions`. The separate `/api/mcp/direct`
endpoint exposes direct tools and is not used for the signing handoff.

## Stage the minimal transaction through MCP

Use this exact prompt, replacing the address with the currently connected test
wallet address:

> On Base chain 8453, stage a transfer of exactly 1 wei from
> `0xYOUR_TEST_WALLET` to the same `0xYOUR_TEST_WALLET`. Do not send any other
> transaction. Stop for external wallet approval.

The MCP client should call `aomi_chat`. Record the returned `session_id`,
`cursor`, status, and redacted pending request ID. While the result is
`processing`, call `aomi_check` with that `session_id` and latest `cursor`.
Stop when it reports `awaiting_user` and a `tx-N` pending request.

Before signing, establish that this new staged action has not executed:

- the new session reports `awaiting_user`, not `complete`;
- `aomi_check` has no confirmed transaction hash for the new staged ID;
- a fresh isolated CLI state contains no signed journal entry for that ID; and
- `aomi tx list` shows the ID under **Pending**, not **Signed**.

Do not infer execution from the wallet balance: a self-transfer does not change
the account's net principal balance.

## Direct MCP client flow

Use `npx @modelcontextprotocol/inspector@latest` against the public endpoint to
exercise SIWE, OAuth dynamic client registration, PKCE, consent, token refresh,
MCP discovery and the chat/check/list/interrupt tools. Never capture the process
environment or credentials.

## Resume and sign with the updated CLI

Use an isolated state directory for each take. From a source checkout, use
`node packages/cli/dist/bin.js` in place of `aomi` below.

```bash
export AOMI_STATE_DIR="$(mktemp -d /tmp/aomi-mcp-demo.XXXXXX)"
case "$PRIVATE_KEY" in 0x*) ;; *) export PRIVATE_KEY="0x$PRIVATE_KEY" ;; esac
aomi wallet set "$PRIVATE_KEY"
aomi account login \
  --backend-url https://chat-staging.aomi.dev \
  --wallet \
  --no-browser \
  --chain 8453
aomi account whoami
aomi session resume "$MCP_E2E_WALLET_SESSION"
aomi tx list
aomi tx simulate "$MCP_E2E_PENDING_REQUEST"
aomi tx sign "$MCP_E2E_PENDING_REQUEST"
```

`MCP_E2E_PENDING_REQUEST` is one ID such as `tx-2`, copied from the smoke or
MCP result. Review the recipient, chain, 1 wei action value, simulation, and
fee line before allowing `tx sign` to proceed. A tiny nonzero fee is printed in
ETH with sufficient precision and again as an exact integer number of wei.

On full success, the CLI prints the action hash, prints the service-fee hash
separately, persists the action as signed, sends a `wallet:tx_complete`
callback with the authoritative staged ID, synchronizes state, and prints
`Backend notified.`

If the action confirms but the service-fee leg fails, the command deliberately
exits nonzero after it:

- records and displays the confirmed action hash;
- sends the successful action callback to the backend;
- removes the action from pending and keeps it in the signed journal;
- records the fee as failed with its exact amount and recipient; and
- says not to rerun that staged ID.

There is no automatic fee-only retry in `0.5.1`. Give the recorded fee amount,
recipient, action hash, session ID, and staged ID to an operator for separate
reconciliation. Do not send a fee transfer manually unless an operator has
verified that it remains owed.

After either full success or the documented partial-fee outcome, prove retry
safety:

```bash
aomi tx list
aomi tx sign "$MCP_E2E_PENDING_REQUEST"
aomi tx list
```

The action must remain under **Signed**, must not return under **Pending**, and
the retry must report that no transaction was rebroadcast (or recover only a
missing backend notification). Never continue if it submits a second action.

## Confirm MCP completion and the public receipt

Back in the MCP client, call `aomi_check` again with the wallet session ID and
latest cursor. The state should advance from `awaiting_user` to `complete`, and
the pending request list should be empty. Record the final status and cursor.

Open the action hash at:

```text
https://basescan.org/tx/0xACTION_HASH
```

Verify chain 8453, successful status, sender and recipient equal to the test
wallet, and value exactly 1 wei. If the fee succeeded, open its separately
labeled hash and verify its amount and recipient independently.

## Camera checklist

Show, in this order:

1. The staging MCP endpoint and the four discovered primary tools.
2. The exact 1 wei self-transfer prompt.
3. `aomi_chat` followed by `aomi_check` reaching `awaiting_user`.
4. The session ID and pending staged ID, with all credentials redacted.
5. CLI `0.5.1`, authenticated wallet address, and resumed MCP session.
6. `aomi tx list`, the simulation, exact action value, and the fee in ETH plus
   wei.
7. The action hash and separately labeled fee outcome.
8. `aomi tx list` showing no pending action.
9. A second `tx sign` proving no rebroadcast.
10. `aomi_check` reaching `complete` and the successful public Base receipt.

Never show a private key, bearer token, cookie, authorization code, PKCE value,
secret file contents, shell history, process environment, or unredacted network
request headers.

After the take, move the isolated `AOMI_STATE_DIR` to Trash because it contains
the persisted test signing key. Do not delete or modify the protected source
secret file.

## Troubleshooting and recovery

- **OAuth discovery or connection fails:** verify the exact HTTPS `/api/mcp`
  URL with the deterministic smoke or MCP Inspector. Refresh the MCP connection
  after server metadata changes.
- **Wrong account or wallet:** stop before signing. Clear the isolated take and
  repeat SIWE/OAuth with the intended test wallet; do not override a mismatch.
- **No pending transaction:** keep polling the same session with `aomi_check`.
  If it ends without `awaiting_user`, create a new session and restage; never
  invent a staged ID.
- **Simulation fails:** do not sign. Capture the redacted failure and create a
  fresh request only after the cause is understood.
- **Action succeeded, fee failed:** this is a finalized partial outcome, not a
  safe whole-operation retry. Preserve the action hash, verify pending is
  cleared, and follow the operator reconciliation path above.
- **Callback was interrupted after broadcast:** rerun `aomi tx sign` for the
  same ID once. The local signed journal should replay only the backend callback
  and report that no transaction was rebroadcast.
- **MCP remains `awaiting_user`:** first run the same CLI command once to recover
  a missing callback. If the action is already journaled and the state still
  does not advance, stop and escalate with only session ID, staged ID, public
  hashes, timestamps, and redacted error text.
