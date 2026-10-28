---
"@aomi-labs/cli": minor
---

The CLI runs on `new Aomi()`. Commands are Stricli (`aomi --help` shows the tree; `--help-all` the hidden flags; old paths such as `session`, `wallet`, `app` and `account login` are aliases). Sign-in is `aomi login` (one device code) or `--private-key` (SIWE, also the signer); the provider loopback, wallet login, `--account-bearer` and session swaps are gone. `aomi -p` prints the reply on stdout and the decoded trace on stderr, `--json` prints NDJSON, and exit codes mean something (2 usage, 3 waiting for you). `aomi` opens a pi-tui chat screen. `--chain` takes decimal ids only. Removed: `tx simulate`, `tx submit`, `tx preflight`, the EIP-5792/MetaMask Action exports and the raw Pipeline lifecycle commands.
