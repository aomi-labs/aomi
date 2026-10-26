---
"@aomi-labs/account": patch
---

Preserve the configured public wallet-login domain when a staging Portal request reaches its allowed Vercel preview through Edge. Keep direct preview domains and production behavior unchanged; reject unconfigured browser origins and ignore forwarded headers when selecting the wallet domain.
