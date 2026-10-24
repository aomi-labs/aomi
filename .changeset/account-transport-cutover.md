---
"@aomi-labs/account": minor
---

Remove the unused mintAgentApiBearer and AGENT_API_AUDIENCE exports and the obsolete response_transform proxy failure variant. Call mintDelegatedBearer with the target service audience.

Use BACKEND_URL for the server upstream; AOMI_PROXY_BACKEND_URL is no longer read. Landing session aliases and Portal control aliases now return 404; consoles use current thread routes.

Backend URL resolution now lives in @aomi-labs/account/forward; the standalone @aomi-labs/account/backend-url subpath is removed. The service topology retains its assertServerOnly export from the owning implementation module.
