---
"@aomi-labs/client": patch
---

Refreshing an OAuth grant keeps all its scopes. A refresh made for one call used to save a token for only that call's scopes, so the next call needing another scope started a new sign-in.
