---
"@aomi-labs/account": patch
---

Linking a login whose parts belong to two other accounts now offers a merge with the strongest owner (the login, then a wallet, then the email) instead of a plain conflict. `IdentityConflictError` carries that owner as `signalOwner`.
