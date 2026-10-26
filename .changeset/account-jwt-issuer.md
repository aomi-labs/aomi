---
"@aomi-labs/account": patch
---

Better Auth JWTs (the edge principal token among them) now carry the configured issuer, the OAuth authorization server `<portal origin>/api/auth`, instead of the bare portal origin; the `issuer` option was passed at the wrong nesting level and ignored.
