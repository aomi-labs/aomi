---
"@aomi-labs/smither": patch
---

Import `BackendClient` from the workspace package `@aomi-labs/internal` instead of `@aomi-labs/deploy`. The package is private, so tsup bundles it into the published library and CLI and it is a devDependency only; the published Smither surface is unchanged.
