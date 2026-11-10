---
"@aomi-labs/account": patch
---

Add request-scoped account auth configuration so a canonical Chat authority and
an explicitly bounded legacy hostname cannot exchange issuer/resource policy
through process-wide environment state. No hosted issuer is activated by this
package change.
