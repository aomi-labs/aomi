# Aomi CLI

Install `@aomi-labs/cli` to use the `aomi` terminal command. The CLI depends on
the public `@aomi-labs/client` transport, account graph and conversation model.

```sh
npm install -g @aomi-labs/cli
aomi --help
aomi account login
aomi session list
```

`AOMI_BACKEND_URL` selects a Portal/BFF origin. The CLI defaults to
`https://chat.aomi.dev`. Account login creates a separate session lasting 24
hours. Local state lives under `~/.aomi` (`AOMI_STATE_DIR` overrides it).

Use `https://chat-staging.aomi.dev` for staging. The `api.aomi.dev` and
`api-staging.aomi.dev` origins serve the backend and do not host guest login.
An HTTP 404 during guest sign-in reports the selected origin and the missing
route. `aomi config current --json` reports the effective origin and whether it
comes from `--backend-url`, `AOMI_BACKEND_URL`, the saved session, or the default.
The output omits URL credentials, paths and query strings. A shell override
takes precedence over saved configuration. Keep these overrides local to the
CLI when other tools need a direct backend origin.

The `aomi` bin shipped by `@aomi-labs/client` is a migration shim that asks you
to install `@aomi-labs/cli`; install the CLI package directly for new setups.

## Prepare a payment

Resolve the source wallet, source chain, destination chain, token contract,
amount and recipient before asking the agent to build a payment. Mainnet alone
does not identify a chain. Check the selected operational wallet's live token
and gas balances on its known funded chains first. A previous refill may have
been bridged or swapped into a different asset. Compare any fresh route's
minimum destination output and fees with the requested payment, and report a
shortfall before preparing a transaction. Use a treasury refill only when the
user selected that source or authorizes it after seeing the shortfall.

`aomi wallet current` shows the configured address; it does not prove that the
wallet is funded or that its signer is authorized for the intended network.
Supply the intended sender with `--public-key` and chain with `--chain` on a
fresh chat. Keep private keys in the designated local signer, out of prompts
and command arguments.

## Review and execute a Commit

```sh
aomi tx list --json
aomi tx export <commit-id> --format commit > payment.json
```

Check the exact sender, chain, token, amount, recipient, fees and simulation
in the durable review. `tx list` includes both Commits and legacy Actions; an
empty Actions list does not mean a Commit is missing. `tx simulate` operates
on legacy EVM Actions; Commit simulation evidence belongs to its review.

For an authorized payment with an available local signer, use
`aomi tx sign <commit-id>`. If signing happens externally, preserve the exact
export and use `aomi tx submit <commit-id> --signed-file <path>` to report its
signed payloads, or `--tx-hash <hash>` to report the already broadcast prepared
transaction. An unsigned export is not a payment.

Re-read `aomi tx list --json` before retrying. Resume the existing Commit and
reconcile its transaction hash with the chain receipt before requesting a new
signature. Report prepared, simulated, signed, submitted and confirmed states
separately. Close the payment only after verifying the successful receipt,
token Transfer event and recipient balance change; a cross-chain payment also
requires the destination receipt and spendable output token.

## Operational funding and payment evidence

`aomi tx preflight payment-intent.json` inspects the explicitly catalogued
operational positions in that file. It reports destination payment terms,
source token balances, native gas budget and token shortfall, then selects a
funded operational source. Treasury, development and third-party positions are
excluded. Check all known funded chains; one empty Ethereum balance does not
establish a wallet shortfall. A different chain or token is `route_required`,
with fees `unquoted`; obtain a fresh route and verify its minimum destination
output before treating it as funding. Native gas values are base units; the
budget uses estimated gas times twice the current gas price, not a guaranteed fee.

Example input (addresses and RPC URLs must come from your approved catalog):

```json
{
  "payment": {
    "asset": {
      "chainId": 1,
      "token": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      "decimals": 6
    },
    "recipient": "0x2222222222222222222222222222222222222222",
    "amount": "1500"
  },
  "rpcUrl": "https://ethereum-rpc.publicnode.com",
  "sources": [
    {
      "address": "0x1111111111111111111111111111111111111111",
      "role": "operational",
      "asset": {
        "chainId": 1,
        "token": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        "decimals": 6
      },
      "rpcUrl": "https://ethereum-rpc.publicnode.com"
    }
  ]
}
```

After selection, save the approved source address as `payment.sender` in the
same file. Retain this intent, the original session ID and the full Commit ID
with the payment record. Keep credentials outside this file and protect RPC
credentials if an endpoint requires them; reports omit RPC URLs.

```sh
aomi tx status <commit-id> --payment payment-intent.json
```

This command refreshes the existing durable Commit through `CommitController`
and asks the SDK's `EvmPayment` to reconcile its review, simulation, transaction
hash, canonical receipt, exact token Transfer and recipient balance delta.
`canRequestSignature` stays false after a hash or outstanding wallet attempt
exists. Reuse the same Commit after a timeout. The command never signs or sends.
A successful receipt alone is not `payment_completed`; recipient verification
must pass too. An unavailable historical balance or an outgoing payment in the
same block leaves verification pending for manual reconciliation.

This evidence reader supports one direct ERC-20 EOA transfer. Swaps, bridges,
AA and batches require their own destination evidence; it cannot declare them
paid. It adds a projection of the existing Commit, not a second execution or
persistence mechanism. SDK consumers use `EvmPayment.preflight()` and
`EvmPayment.status()` directly; CLI adapters own only file input and output.
