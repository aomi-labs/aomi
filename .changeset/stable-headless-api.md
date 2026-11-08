---
"@aomi-labs/client": patch
"@aomi-labs/cli": patch
"@aomi-labs/account": patch
---

Route headless SDK and CLI defaults through api.aomi.dev. Isolate the API's OAuth issuer and resources from Chat domain changes using request-scoped account configuration. Existing explicitly configured endpoints remain valid. Deploy and verify the API account surface before publishing these client defaults.
