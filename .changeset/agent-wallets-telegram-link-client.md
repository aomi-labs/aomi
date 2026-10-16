---
"@aomi-labs/client": patch
---

Link Telegram to a portal account (agent wallets, step 5). `client.account.telegramLink` (`AccountTelegramLinkTransport`) previews, confirms and cancels a `/link` code with `previewTelegramLink(code)`, `confirmTelegramLink(code)` and `cancelTelegramLink(code)`; the code travels in the POST body. Refusals are `TelegramLinkError`, which keeps the server's `error` code and its extras (`sameAccount`, `inFlight`). `isTelegramLinkCode` checks a code's shape. Portal sessions only, so these are not on `Aomi`. Connections' `telegram` gains `linked_from` and `linked_at`, and `AomiAccountWallet` gains `pinned_telegram`. Hand-written wire types.
