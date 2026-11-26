---
"@aomi-labs/cli": patch
---

The CLI tells the backend when a local Solana key signs v1 transactions, so a large Solana transaction is built as v1. `aomi tx sign` signs an EVM commit on the commit's own chain when `--chain` is not given, and `--rpc-url` shows in help.
