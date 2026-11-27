---
"@aomi-labs/widget": minor
---

`useConsentAskModes().save` now saves when Instant is picked on a wallet whose admin is a wallet: those wallets are written on Ask and their Instant filed as a policy change, as Settings does. Breaking: `save` resolves to `{ saved, note? }` instead of a boolean; `note` is the refusal code or the Instant left waiting.
