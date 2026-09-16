# Aomi Telegram Wallet

A single-page Telegram Mini App for responding to Aomi Actions with Para.
It uses Para's native Google or Telegram login, exchanges the Para session for
an origin-bound Aomi widget session, resolves the canonical Aomi account, and
opens the Telegram-launched Aomi thread through the Portal BFF.

## Configuration

- `NEXT_PUBLIC_PARA_API_KEY`: Para project API key
- `NEXT_PUBLIC_PARA_ENVIRONMENT`: `BETA` or `PROD`
- `NEXT_PUBLIC_AOMI_BFF_URL`: defaults to `https://chat.aomi.dev`

The bot launches the Mini App with `bot_id`, `session_id` (or Telegram
`start_param`), and an optional `request_id`. The Vercel origin must be in both
the Portal BFF widget-origin allowlist and the Para project's allowed origins.

## Supported Actions

- Single EVM transactions
- EIP-712 typed-data signatures
- ERC-191/plain-message signatures

Strict 4337/7702 execution remains backend-owned. Unsupported Solana Actions
and non-atomic transaction bundles are explicitly rejected so the backend gets
a terminal acknowledgement instead of risking partial execution.

Run `pnpm --filter telegram check` for the complete local validation gate.
