# Recipient and approval review

Check protocol-specific fields that can redirect value. Validate each against
the user-approved sender/recipient and route intent, along with token contract,
chain, amount, allowance and minimum output. Several protocols carry a second
redirecting field, often a refund address; check both.

| Protocol / call | Fields that receive value |
| --- | --- |
| Uniswap V3 `exactInputSingle` / `exactOutputSingle` | `recipient` |
| Uniswap V2 / Sushi V2 `swapExactTokensForTokens` | `to` |
| 1inch v6 `swap` | `dstReceiver` inside the `SwapDescription` tuple |
| Curve `exchange` | none; output returns to `msg.sender` |
| Aave V3 `supply` / `repay` | `onBehalfOf` |
| Aave V3 `borrow` / `withdraw` | `to` |
| Compound V3 `supplyTo` | `dst` |
| Morpho `supply` | `onBehalfOf` |
| CCTP `depositForBurn` | `mintRecipient` (bytes32, left-padded address) |
| Across `depositV3` | `recipient` |
| Stargate `send` | `SendParam` recipient **and** `refundAddress` |
| Arbitrum `outboundTransferCustomRefund` | `_to` **and** `_refundTo` |
| OP-stack `bridgeETHTo` / `depositETHTo` | `_to`; zero address permanently locks funds on L2 |
| zkSync `requestL2Transaction` | `_contractL2` **and** `_refundRecipient` |
| LST `transfer` / `transferFrom` (stETH, wstETH, rETH, eETH) | `_to` |

Read the current Commit simulation's guards and warnings. Their exact policy is
runtime-dependent; do not assume every non-self recipient is blocked or that a
warning can always be acknowledged. Surface a guard failure with the affected
field and approved intent. Correct genuine construction errors and obtain a
fresh reviewed simulation. Keep intentional external recipients explicit, and
never reword the prompt or switch apps to get past a guard.

Zero-address or burn-address destinations are never a typo to retry through;
stop and confirm the address. A source bridge transaction and its recipient
field alone do not prove destination receipt or spendable output. See
[workflows.md](workflows.md#reconciliation).
