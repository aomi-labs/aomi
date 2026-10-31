# Payment workflows

## Funding

Resolve destination chain ID, token contract/decimals, amount and recipient first.
Read the wallet catalog's role/address/chain metadata without exposing keys.
For each known operational position, obtain fresh token and native gas balances
from a chain-matching RPC. Check the actual token contract, not only its symbol.
Exclude treasury, development and third-party wallets from automatic selection.
Role metadata records provenance; it does not grant signing authorization.

When available, `aomi tx preflight <intent-file>` performs these read-only checks
for every wallet listed in the file, each on its own RPC. File shape:

```json
{
  "recipient": "0x2222222222222222222222222222222222222222",
  "amount": "1500",
  "wallets": [
    { "address": "0x1111111111111111111111111111111111111111", "chainId": 1, "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "decimals": 6, "rpcUrl": "https://ethereum-rpc.publicnode.com" },
    { "address": "0x1111111111111111111111111111111111111111", "chainId": 8453, "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "decimals": 6, "rpcUrl": "https://base-rpc.publicnode.com" }
  ]
}
```

Replace example terms with the approved catalog and user request. Add an entry
for each known funded chain; the command checks only what is listed. Keep
private keys and bearers outside the file and secure any credentialed RPC URLs;
reports carry only a short reason, never the URL.

Each wallet reports `funded`, `insufficient_token`, `insufficient_gas` or
`unavailable` with a reason, plus its token balance, native balance and an
estimated gas budget in native base units (gas estimate × twice current gas
price). This is a budget, not a guaranteed fee. A wallet holding a different
token or chain than the destination needs a fresh route with verified minimum
destination output before it counts as funding. A failed RPC is unavailable
evidence, not a zero balance. A token-funded wallet without native gas is not a
funded direct-transfer source. Report the operational shortfall before proposing
any separately authorized treasury refill.

## Execution

Use the main skill's prepare/review procedure, preserving its original session.
Export the exact full Commit ID and check all payment terms, simulation and
fees. Use only the reviewed Commit for execution. For local authorized signing:

```sh
aomi tx sign <commit-id>
```

For external signing, hand the unchanged export to the designated signer. A
signed export must retain `format: "aomi.commit.v1"`, the exact current `commit`
and a top-level `payloads` array. Report it using `tx submit --signed-file`.
For a wallet-broadcast prepared transaction, report its exact expected hash with
`tx submit --tx-hash`. A modified/expired review needs fresh review before signing.

## Reconciliation

Resume the original session and refresh the existing Commit with
`aomi tx list --json` before retrying. An outstanding wallet attempt, signed
payload or known transaction hash must be reconciled before requesting a new
signature; a timeout does not mean failure. The backend observes the receipt
and moves the Commit to `confirmed`; `aomi tx export <commit-id> --format commit`
shows the current state. Keep all stages attached to that ID:

| Evidence | Report |
| --- | --- |
| Prepared review, no valid simulation | Prepared; review incomplete |
| Passed simulation, no signature | Simulated; awaiting authorized signature |
| Signed, not submitted | Signed; awaiting submission |
| Hash, Commit not yet confirmed | Submitted/pending; reconcile that hash |
| Commit failed or receipt reverted | Failed on chain; preserve evidence |
| Commit confirmed | Payment completed on the source chain |

Do not infer a second payment is needed from a timeout or a stale listing.
For bridges, a source receipt is only the source leg; verify the destination
receipt, output token and spendable balance separately.

## Secret ingestion

Use an existing authorized signer for execution. Changing credentials is a
separate, explicitly requested setup action. CLI wallet setup persists local
signing material in private state; secret ingestion transmits supplied app
credentials to the backend and stores returned handles locally. Explain that
storage/transmission boundary before setup. Keep values opaque: report only
address, credential name/presence or handle name, never values or signed bytes.
