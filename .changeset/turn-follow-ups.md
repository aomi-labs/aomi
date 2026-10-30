---
"@aomi-labs/client": minor
"@aomi-labs/react": minor
"@aomi-labs/widget": minor
"@aomi-labs/cli": minor
---

A message sent while a turn is working joins that turn. `Session.steer` posts it to `/v1/agent/chat/{sessionId}/steer` and resolves `false` when no turn is running. Portal and the embedded chat keep Send available during a run and split the working trace at the follow-up. The CLI REPL accepts input while a reply streams, and `aomi chat` adds to a running request.
