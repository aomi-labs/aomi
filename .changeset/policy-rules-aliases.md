---
"@aomi-labs/account": patch
"@aomi-labs/client": patch
---

The route policy no longer admits the retired `/rules`, `/rules/catalog` and `/rule-changes` account paths; the backend serves only their `/policy` names. The client's generated route scopes follow.
