---
"@aomi-labs/react": minor
---

`AomiRuntimeProvider` takes `aomi` or makes one; the display cache's `apiClient` is now `aomi`; `ControlContextProvider` takes `aomi`. `CONTEXT_STEP_TOOL` and `ContextStep` come from `@aomi-labs/client/trace`. React no longer re-exports `AomiClient`, the wallet helpers and types (import them from `@aomi-labs/client`), `cn` (from `@aomi-labs/widget`) or `formatAddress` (use `shortAddress` from `@aomi-labs/client`).
