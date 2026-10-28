---
"@aomi-labs/client": minor
---

`new Aomi({ auth: wallet(account) })` signs in with SIWE (an EVM key, for bots and scripts) and uses the session on every route. `oauth()` takes `scopes` for what the first sign-in asks for, and the device flow registers a public client (`clientName`) when no `clientId` is given.
