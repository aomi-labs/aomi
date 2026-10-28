---
"@aomi-labs/client": minor
---

Add the `@aomi-labs/client/trace` subpath: the React-free trace decoder the widget uses. `decode(step)` turns a tool call into a title, chips, status and icon key; `traceFromEvents(events)` groups one turn into notes, steps, delegated agents, context steps and folded `read_tool_output` reads. Icons are string keys (`"swap"`, `"simulate"`, `chain:8453`), so each renderer picks its own glyphs. The root entry does not import it.
