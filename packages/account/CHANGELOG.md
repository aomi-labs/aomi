# @aomi-labs/account

## 0.2.11

- Stop granting the `custody:delegate` OAuth scope (per-wallet signing rules replace it) and serve the account's connected OAuth clients and Telegram bots, with per-client disconnect, from the Better Auth tables.

## 0.2.10

- Require verified portal sessions for agent wallet creation and revoke retained agent signing authority when an account is deactivated.

## 0.2.9

- Reuse shared account client transport and typed HTTP errors while preserving authentication and wallet contracts.
- Keep server session synchronization and origin checks explicit at the BFF boundary.
