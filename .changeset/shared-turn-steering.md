---
"@aomi-labs/client": patch
"@aomi-labs/react": patch
"@aomi-labs/widget": patch
"@aomi-labs/cli": patch
---

Add explicit host-backed steering, independent queued requests, targeted cancellation, and durable input receipts. Keep visible conversations subscribed across turns, preserve rejected drafts and uncertain input identities, and expose matching update/queue controls in the widget and interactive CLI.

Keep CLI server options effective through nested commands and isolate saved credentials when switching servers. Preserve a chat sent before the initial Portal history load, and refresh authorized control state after a rejected update without changing its retry identity.
