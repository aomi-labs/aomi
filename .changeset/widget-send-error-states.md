---
"@aomi-labs/client": patch
"@aomi-labs/react": patch
"@aomi-labs/widget": patch
---

A send that never started now ends at once. A 503 `app_loading` and a failed guest session check no longer leave the thinking indicator and Stop running. The composer gets the message back and a notice says what happened. A failed guest session check is a `GuestSignInError`. The new notices read "App starting" and "App not available" for a 403 or 404 on a Direct App. In a Direct-only widget the composer keeps a failed message's text: its editor no longer clears the restored draft when it remounts. A finished working trace with a failed step shows a warning and the failed count in its header.
