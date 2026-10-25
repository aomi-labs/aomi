---
"@aomi-labs/deploy": minor
---

Add `@aomi-labs/deploy/schemas`: zod schemas for every manager response, which read the snake_case wire and output the camelCase shapes. The exported response types are now inferred from them. Fields the manager may omit read `null` (or `[]`) instead of being optional, and `PlatformApp.loaded` reads `undefined` until a runtime probe answers. `deploymentTargets` takes a parsed deployment.
