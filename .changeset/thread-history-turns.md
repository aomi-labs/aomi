---
"@aomi-labs/client": minor
"@aomi-labs/cli": patch
---

`thread.history()` also returns the thread turn by turn (your message, its tool calls, the agent's replies, working time) and takes `{ decode }` like `turn.steps()`. The CLI chat screen shows past turns with their steps, and links are clickable.
