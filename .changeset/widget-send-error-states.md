---
"@aomi-labs/client": patch
"@aomi-labs/react": patch
"@aomi-labs/widget": patch
---

A send that never started now ends at once. A failed guest sign-in and a 503 `app_loading` no longer leave the thinking indicator and Stop running. The composer gets the message back and a notice says what happened. Guest sign-in failures are `AomiApiError`s with code `guest_sign_in_failed`, and a 429 carries its `Retry-After` seconds in `details.retryAfter`. The new notices read "App starting", "Too many requests" with the wait in seconds, and "App not available" for a 403 or 404 on a Direct App. In a Direct-only widget the composer keeps a failed message's text: its editor no longer clears the restored draft when it remounts. A finished working trace with a failed step shows a warning and the failed count in its header.
