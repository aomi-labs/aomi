---
"@aomi-labs/client": minor
"@aomi-labs/widget": minor
"@aomi-labs/cli": minor
"@aomi-labs/account": minor
---

An agent wallet's "lane" is now its "ask mode". Breaking: the wire field `lane` is `ask_mode` on wallets, on a wallet's connections, on a connection's wallets and in `new_app_wallet`, and the old name is no longer read or sent, so this ships with the backend that renames it. `AomiLane` is `AomiAskMode`; the values (`ask_aomi`, `ask_client`, `instant`) are unchanged. In the widget, `ConnectionLanes` is `ConnectionAskModes`, `useConsentLanes` is `useConsentAskModes`, and `ConsentWallets` takes `startAskMode` in place of `startLane`.
