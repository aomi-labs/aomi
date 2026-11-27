---
"@aomi-labs/cli": patch
---

The chat screen signs a commit with the local key in place: when a local key can sign the agent's transaction, a Sign box shows it, `s` signs and sends it on the commit's chain, and the chat goes on with the agent's answer. Before, the chat printed `aomi tx sign <ref>` and you had to quit to run it. A commit no local key signs shows its Aomi sign link.
