---
"@aomi-labs/client": patch
"@aomi-labs/widget": minor
---

Refresh an OAuth grant with its full scope set instead of the narrower scopes of the request that triggered it, so a balance read no longer strips checkout's `account:credits:fund` and `offline_access` from the stored grant. `CreditCheckoutDialog` takes an optional `reconnect` callback: when the host's authorization lapses, checkout blocks payment, offers Reconnect Aomi, and resumes with the same amount, method and idempotency key.
