---
"@aomi-labs/client": minor
"@aomi-labs/cli": patch
"@aomi-labs/widget": patch
---

`TRANSACTION_SAFETY_NAMES` gives the guard modes their shared names (Strict, Balanced, Yolo); the widget uses them. The CLI chat screen gains `/guard` and drops `/mode`; chat routes Auto unless `--app` pins an app for a run (`aomi apps use` is gone). `aomi guard` takes strict, balanced or yolo. Concurrent calls that need a wider sign-in share one device approval, and the `/v1` sign-in asks for all the client's scopes.
