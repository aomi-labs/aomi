# Payment examples

These examples use placeholder terms. First apply the capability gate in
[commands.md](commands.md#availability); read the installed help for exact flags.

## Direct operational payment

1. Resolve the requested destination chain/token, recipient and exact amount.
2. Build an intent file from approved operational positions across known chains.
   Run `aomi tx preflight <intent-file>` and show each wallet's state, gas
   budget and any shortfall. Choose the sender from the funded wallets with the user.
3. Use a new chat with the exact sender/chain and approved payment intent.
4. Read `aomi tx list --json`; export its full Commit ID with `--format commit`.
5. Review terms, calldata, fees and passed simulation. Execute the authorized
   Commit with the designated signer or report an external signer's exact export.
6. Preserve the original session, intent and Commit ID. Refresh the same
   Commit with `aomi tx list --json` until it is `confirmed`; never start a
   second payment for the same intent.

If the process disconnects after a wallet prompt, return to step 6. A timeout
is not permission to request a duplicate signature or create a new payment.

## Operational funds on another chain or in another asset

An empty destination-chain USDC balance does not prove the operational wallet
is unfunded. Inspect its known positions first. If it holds USDG on another
chain, report that exact asset and chain, then request a fresh route with fees
and minimum destination USDC output. Distinguish conversion, bridge and final
transfer legs, along with native gas requirements. Show any residual shortfall
before discussing a separately authorized treasury refill.

Reuse reviewed Commit IDs for each leg. Confirm the bridge's destination receipt
and spendable output before preparing the final transfer. A source-chain
confirmation does not declare a cross-chain route completed.

## Approve and swap, lending or staking

Inspect the complete reviewed Commit, including approval spender/amount and each
leg's order. Simulation for the Commit belongs to that review. An old `tx-N`
Action may appear in historical sessions; apply its installed CLI's documented
simulation behavior only after explicitly identifying that legacy branch.
Fresh preparation should use Commit IDs. Review destination token and actual
recipient effects before declaring execution complete.
