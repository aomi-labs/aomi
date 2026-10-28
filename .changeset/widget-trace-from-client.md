---
"@aomi-labs/widget": patch
"@aomi-labs/react": patch
---

The working trace now decodes tool calls with `@aomi-labs/client/trace` instead of a widget copy, mapping its icon keys to the same Lucide icons and logos. `CONTEXT_STEP_TOOL` and `ContextStep` from `@aomi-labs/react` are re-exported from there. No visible change.
