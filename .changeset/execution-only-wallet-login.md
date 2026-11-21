---
"@aomi-labs/account": minor
---

Wallet sign-in refuses keys the server can sign for (`provider_managed` agent wallets) and wallets no human enrolled for login (`public_keys.login_allowed = false`) with 401 `wallet_login_not_allowed`. `upsertWallet`, `upsertVerifiedWallet` and `syncProviderWallets` take a required `loginAllowed`; the provider link functions take it too. Only a portal session enrolls a wallet. Needs product-mono migration `20261101020000_public_keys_login_allowed`.
