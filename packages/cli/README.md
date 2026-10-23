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

## Check funding before a payment

`aomi tx preflight intent.json` reads each listed wallet's live token and native
balance on its own RPC and reports whether it can fund the transfer: `funded`,
`insufficient_token`, `insufficient_gas`, or `unavailable` with a short reason.
It never signs. List every chain the wallet is funded on; an empty Ethereum
balance does not mean the wallet is empty. The gas budget is the estimated gas
times twice the current gas price, in native base units, and is an estimate
rather than a quote. A failed RPC is `unavailable`, not a zero balance.

```json
{
  "recipient": "0x2222222222222222222222222222222222222222",
  "amount": "1500",
  "wallets": [
    {
      "address": "0x1111111111111111111111111111111111111111",
      "chainId": 1,
      "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "decimals": 6,
      "rpcUrl": "https://ethereum-rpc.publicnode.com"
    },
    {
      "address": "0x1111111111111111111111111111111111111111",
      "chainId": 8453,
      "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "decimals": 6,
      "rpcUrl": "https://base-rpc.publicnode.com"
    }
  ]
}
```

Addresses and RPC URLs come from your own wallet catalog. Keep private keys out
of the file. Use a treasury wallet only when the user chooses it after seeing
the shortfall.

## Review and execute a Commit

```sh
aomi chat "<exact intent>" --new-session --public-key <sender> --chain <chain-id>
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

Re-read `aomi tx list --json` before retrying. A Commit that already has a
transaction hash or an outstanding wallet attempt is reconciled, not re-signed;
the backend observes the receipt and moves the Commit to `confirmed`. A
cross-chain payment also needs the destination receipt and spendable output token.
