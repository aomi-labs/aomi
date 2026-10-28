---
"@aomi-labs/client": minor
---

`new Aomi({ auth: wallet(account) })` signs in with SIWE (an EVM key, for bots and scripts) and uses the session on every route. The device flow registers a public client (`clientName`) when no `clientId` is given.
