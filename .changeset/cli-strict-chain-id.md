---
"@aomi-labs/cli": patch
---

Reject a `--chain` or `AOMI_CHAIN_ID` value that is not a decimal chain ID. `base` was ignored, so the session fell back to the stored or default chain, and `8453abc` was read as 8453.
