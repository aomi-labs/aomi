---
"@aomi-labs/client": minor
"@aomi-labs/widget": minor
"@aomi-labs/cli": minor
"@aomi-labs/deploy": patch
---

Aomi Chat's production host is `https://aomi.chat`. The SDK, CLI and widget default to it, guest sign-in hints name it, and the deploy skill points at it. `chat.aomi.dev` only answers a permanent 308 redirect to `aomi.chat`: sessions and OAuth tokens it issued no longer verify, so authenticated clients must upgrade or pass `baseUrl: "https://aomi.chat"`.
