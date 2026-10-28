---
"@aomi-labs/client": minor
"@aomi-labs/react": minor
"@aomi-labs/widget": minor
---

First-party code runs on one `Aomi`.

- client: `aomi.account.keys` (the BYOK and secrets vault, `/v1/account/keys`: `set`, `list`, `remove`, `clear`) and `aomi.account.policies` (on-chain Swig policies, `/v1/account/policies/swig`); `AomiClient`'s secret methods use them. `aomi.builder.credits`. `apps.install/uninstall/credentials` also take an application id; `credentials().save(values)` and `clear()`. `guard.set({ revision })`. `account.switchTo(ticket)`, `siweNonce`/`verifySiwe`/`siwsNonce`/`verifySiws`, Solana wallet links, and `exchangeProviderCredential(c, { newSession })`. `AomiClient.resolveAppKey(key)` and `addAccountApp(…, { apiKey })`. `new Aomi({ cookieSession })`, and an `x402` client is kept when there is no signer. `AccountGraphApiError` messages are the server's message or code.
- react: `AomiRuntimeProvider` takes `aomi` or makes one; the display cache's `apiClient` is now `aomi`; `ControlContextProvider` takes `aomi`. React no longer re-exports `AomiClient`, the wallet helpers and types (import them from `@aomi-labs/client`), `cn` (from `@aomi-labs/widget`) or `formatAddress` (use `shortAddress` from `@aomi-labs/client`).
- widget: exports `cn`; drops the deprecated `formatAddress`. `ConsentWallets`, `useConsentLanes` and `TelegramLinkPanel` take any `{ account }`. The account shell is one `Aomi` and never mints a guest.
