---
"@aomi-labs/account": patch
---

Accept Client ID Metadata Documents whose `client_uri` is on a different origin from the document, such as Hermes Agent's. Post-logout redirect URIs stay bound to the `client_id` origin, and authorization redirect URIs are still matched exactly.
