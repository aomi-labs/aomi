---
"@aomi-labs/client": patch
"@aomi-labs/react": patch
"@aomi-labs/widget": patch
---

Only a `payment_required` 402 opens the out-of-funds modal. A `builder_debt` 402 says the App is temporarily unavailable until its builder adds funds, and other 402 codes show "App unavailable". A rate-limited guest sign-in (429) throws `GuestSignInError` with `retryAfterSeconds`, ends the pending send instead of leaving the thinking indicator running, and shows "Too many requests" with the wait. The Coinbase Wallet and Base Account connectors pass `preference.telemetry: false`, so the SDKs no longer load Coinbase's analytics script from cca-lite.coinbase.com.
