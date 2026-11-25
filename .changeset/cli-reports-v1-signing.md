---
"@aomi-labs/cli": patch
---

The CLI tells the backend that its local Solana key signs v1 transactions (`can_sign_v1_transaction`), as the SDK's own wallet state already did. The CLI sends its own user state, which replaced the SDK's, so the backend built legacy or v0 transactions for a CLI turn and a large move, such as a flash loan that wraps a lending move, did not fit one transaction.
