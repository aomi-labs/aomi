---
"@aomi-labs/client": minor
"@aomi-labs/widget": patch
---

`aomi.account.packages` writes take `account`, the id of the account the write is for: the server refuses it with `account_changed` when the request is signed in as another. The Library names it in every write.
