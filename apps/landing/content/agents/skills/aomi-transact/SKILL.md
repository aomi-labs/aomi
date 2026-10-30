---
name: aomi-transact
description: >
  Build natural-language crypto agents, web3 assistants, and trading bots that read
  and write EVM chain state. Aomi turns prompts ("swap 1 ETH for USDC", "open a 3x
  GMX long", "bet $100 on Polymarket") into wallet-signed transactions on Ethereum,
  Base, Arbitrum, Optimism, Polygon, Linea — non-custodial, fork-simulated. Use when
  the user wants a crypto/DeFi agent, AI trading/wallet assistant, or on-chain
  execution against Uniswap, Aave, Lido, GMX, Hyperliquid, Polymarket, Binance, OKX,
  or 40+ other protocols. Trigger with prompts about swaps, lending, bridging,
  staking, perps, prediction markets, or any DeFi/CEX action needing a wallet
  signature. Supports durable Commit review and backend-prepared EVM or AA signing. MUST NOT fabricate
  or echo credentials; values reach the CLI only when the user explicitly supplied them.
compatibility: >
  Node.js 18+. Install @aomi-labs/cli@latest for the aomi terminal command;
  @aomi-labs/client is the TypeScript SDK with a legacy CLI migration shim.
  Verified against published CLI 0.2.0 and SDK 0.11.2. Require CLI 0.2.0 or newer
  and check command capabilities. Installing a skill does not upgrade a global binary.
license: MIT
version: "0.14.0"
author: 'aomi-labs <hello@aomi.dev>'
tags: [crypto, defi, web3, evm, ethereum, wallet, account-abstraction, trading, mcp, agent]
allowed-tools: 'Bash(aomi:*), Bash(npx:*)'
metadata:
  author: 'aomi-labs <hello@aomi.dev>'
  version: "0.14.0"
  repository: aomi-labs/skills
  homepage: https://github.com/aomi-labs/skills/tree/main/aomi-transact
permissions:
  files:
    read: [~/.aomi/]
    write: [~/.aomi/]
    deny_write: [SOUL.md, MEMORY.md, AGENTS.md]
  network:
    allow: [chat.aomi.dev]
    deny: "*"
  shell:
    - aomi
    - npx @aomi-labs/cli@latest
  tools: []
risk_tier: L2
requires:
  binaries: [aomi, npx]
---

# Aomi Transact

Use the TypeScript `aomi` CLI to prepare, review and execute user-authorized
transactions. The Rust `aomi-cli` in product-mono has a different interface.

## Procedure

1. **Establish capabilities.** Read [commands.md](references/commands.md#availability)
   first. Check package availability and installed help; a source test or SDK
   migration message does not prove a working published CLI. Stop a missing
   capability branch with its release requirement; keep a working older binary.
2. **Resolve funding.** Identify the requested recipient, amount, destination
   chain ID and token contract. Read the user's wallet catalog for operational
   addresses and known funded chains. Check live token and native gas balances
   across those positions before preparing a payment. A zero Ethereum USDC
   balance is not a wallet-wide shortfall. Use `tx preflight` when available;
   follow [funding checks](references/workflows.md#funding) otherwise. Keep a
   treasury/Safe refill as a separately authorized source choice.
3. **Bind the intent.** Show the selected sender, source asset/chain, destination
   asset/chain, amount, recipient, estimated fees and shortfall. For conversion or
   bridging, obtain a fresh quote with minimum destination output, gas on each
   leg and route fees. USDC and USDG are different contracts/assets. Finish this
   step with unambiguous, funded terms before building a payment.
4. **Prepare once.** On a new task use `aomi chat "<exact intent>" --new-session
   --public-key <sender> --chain <chain-id>`. Continue its original session on
   follow-ups. Read `aomi tx list --json`, retain the full Commit ID and export
   that exact Commit with `aomi tx export <commit-id> --format commit`.
5. **Review.** Match the durable review to the approved intent, including sender,
   chain, token, amount, recipient, calldata, fees and simulation. Check all legs
   and approval limits. Simulation for a Commit lives in its review; `tx simulate`
   is a separate legacy Action tool. Require passed simulation for execution.
6. **Execute the reviewed Commit.** Use `aomi tx sign <commit-id>` only within
   the user's authorization and an available designated signer. For an external
   signer, preserve the exact export and report the signed payloads or prepared
   broadcast hash through `tx submit`; see [workflows.md](references/workflows.md#execution).
   Inspect prepared AA payloads before choosing the signing path; see
   [account-abstraction.md](references/account-abstraction.md).
7. **Reconcile the same payment.** Retain original session, full Commit ID,
   approved intent and transaction hash together. Refresh that Commit with
   `aomi tx list --json` before retrying; the backend observes the receipt and
   moves it to `confirmed`. A known hash or outstanding wallet attempt calls for
   reconciliation, not a new signing attempt. Report preparation, simulation,
   signature, submission and confirmation separately. Bridge completion also
   needs the destination receipt and spendable output token.

## Credentials and state

Use the existing authorized signer without exposing key material. Credential
setup is a separate user-directed operation; values stay opaque and out of chat,
logs, fixtures and exported payment records. `~/.aomi` may contain signing keys,
bearers and secret handles. Its permission manifest expresses intended scope;
actual enforcement depends on the host. For credential handling, local state
and recovery, read [gotchas.md](references/gotchas.md) and
[session.md](references/session.md).

## Branch references

- **404, missing package, timeout or retry:** [troubleshooting.md](references/troubleshooting.md).
- **Commands, installation and flags:** [commands.md](references/commands.md).
- **Funding, execution and secret ingestion:** [workflows.md](references/workflows.md).
- **Direct payment or bridge walkthrough:** [examples.md](references/examples.md).
- **Protocol field/recipient warnings:** [drain-vectors.md](references/drain-vectors.md).
- **App discovery and prompt examples:** [apps.md](references/apps.md); runtime
  capabilities and this procedure take precedence over historical app examples.

Source: https://github.com/aomi-labs/skills/tree/main/aomi-transact

## Hosted MCP

For hosted tools, connect Agent and Pipeline separately with OAuth:

```sh
codex mcp add aomi-agent --url https://chat.aomi.dev/v1/agent/mcp
codex mcp add aomi-pipeline --url https://chat.aomi.dev/v1/pipeline/mcp
```

Codex derives the resource from each URL; omit `--oauth-resource` to avoid a
second resource parameter. If the authorization page reports a CIMD metadata
fetch error, retry that server's login with `--oauth-client-registration dcr`.
Use a fresh client session to discover both tool sets, then perform a read-only
session-list or catalog call. Enabled configuration alone is not a successful smoke.

Each grant must have the exact connected resource URL as its audience. Agent,
Pipeline, REST and guest credentials are not interchangeable. OAuth grants tool
access; wallet execution still follows the approved Commit and designated signer.
A browser GET can return 404 because these resources accept POST and OPTIONS.
