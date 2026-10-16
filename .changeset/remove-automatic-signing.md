---
"@aomi-labs/widget": minor
"@aomi-labs/client": minor
"@aomi-labs/account": minor
---

Remove provider-delegated and client-side automatic signing. Settings › Safety offers Ask me or Locked per wallet; an agent wallet already on Automatic shows that mode read-only and can still be locked, and the Para "Create agent wallet" action stays. The "Automatic signing" section, its Fix banner, "Use for this session", and delegation renew/revoke controls are gone.

Removed exports: `usePrivyDelegation`, `PrivyDelegationContextValue` and `PrivyDelegationProvider` (widget main, `./host-composition`, `./providers/privy`), and the `DelegatedAccountView` type. `WalletPolicy` drops `delegationActive`, `delegationExpiresLabel` and `canUseAuto`, and its `SignerMode` drops `client_auto`. Privy no longer mounts its client smart-wallet provider; `AomiPrivyProvider` still accepts `execution` but ignores it.

Client: `AomiClient.beginPrivyDelegation` is removed, `AomiAuthPurpose` is only `link_wallet`, and `AomiSigningPolicy.mode` no longer lists `client_auto`.

Account: the `./telegram` entry and the Telegram Mini App sign-in helpers (`findAomiUserForTelegram`, `claimTelegramSessionOwner`, `signInWithTelegramProviderIdentity`) are removed with the Mini App.
