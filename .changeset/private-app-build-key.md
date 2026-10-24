---
"@aomi-labs/deploy": minor
"@aomi-labs/react": patch
"@aomi-labs/widget": patch
---

Builders manage a private App's key from Build: `BackendClient.getBuilderAppKey` shows the current key and `regenerateBuilderAppKey` issues a new one, revoking the old. The App key input and the "App key required" notice now point people to the key the App's builder shared.
