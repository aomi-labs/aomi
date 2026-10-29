---
"@aomi-labs/deploy": minor
---

Move `BackendClient`, `assertServerOnly` and the `./bff` helpers into the workspace package `@aomi-labs/internal` (as `ManagerClient`); `@aomi-labs/deploy` keeps the wire types (now all exported), errors, activation helpers and the browser launch client.
