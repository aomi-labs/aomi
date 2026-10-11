# Aomi Telegram Wallet

A single-page Telegram Mini App that takes a user end to end through the four
steps Aomi needs before its backend can sign on their behalf:

1. **Verify Telegram** — the launch `initData` is verified server-side, then
   exchanged for a Privy Custom JWT so one human has one Privy identity across
   `chat.aomi.dev` and Telegram.
2. **Link your wallet** — the Privy identity token is exchanged for an
   origin-bound Aomi widget session, and the portal attests the embedded wallet
   through Privy's server API so it lands in `public_keys`.
3. **Enable server signing** — Aomi's signer is installed on the wallet as a
   Privy session signer, and the backend callback verifies it and records the
   `signing_delegations` grant.
4. **Authorize signing** — an `AuthorizationPermit` is signed by the embedded
   wallet and committed, moving the key to `server_auto`.

Step 3 is not optional. The backend's `check_auto_preconditions` requires an
active delegation covering the exact key, and it runs at **challenge** time, so
without it step 4 cannot even obtain a permit to sign — the challenge answers
409 `missing_delegated_account`.

The Mini App never broadcasts a transaction. Execution stays backend-owned; this
page only links a wallet and signs permits.

## Configuration

| Variable                   | Required | Notes                                                                                                                                                                   |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | yes      | Must be the **portal's** Privy app id — one app is the whole point. Validated for shape; anything else renders the "not configured" card rather than failing the build. |
| `NEXT_PUBLIC_AOMI_BFF_URL` | no       | Portal BFF origin. Defaults to `https://chat.aomi.dev`.                                                                                                                 |

The existing `NEXT_PUBLIC_*` names remain part of the deployment contract. Vite
inlines only these two approved public values; server credentials are not
exposed to the browser. Set them before building the app.

The portal side must also have `TELEGRAM_WIDGET_BOT_IDS` set: it is the first
check in both widget routes, and an unset value rejects **every** request with
403 `bot_not_allowed`.

## Launch contract

The bot builds the URL (`product-mono`, `aomi/bin/telegram/src/mini_app.rs`).
The bot launches the Mini App with two parameters:

| Param        | Source                                        | Notes                                      |
| ------------ | --------------------------------------------- | ------------------------------------------ |
| `bot_id`     | the bot's own numeric Telegram id             | must be in `TELEGRAM_WIDGET_BOT_IDS`       |
| `session_id` | the canonical thread id, e.g. `telegram:dm:7` | also sent as `X-Thread-Id` when delegating |

The app always targets its own embedded Privy wallet at `server_auto`; it
accepts no wallet or mode override in the launch URL.

`initData` freshness is asymmetric and worth knowing: the app's own
`/api/telegram/launch` verifies with the 24-hour default, while the portal's
widget routes force a **5-minute** window. A Mini App left open longer than that
must be relaunched from Telegram.

## Development

The app uses TanStack Start and Router, Vite, and Nitro. Use an official Node.js
22.15+ or 24 runtime and the repository-pinned pnpm version. Heavy checks and
local services run through the selected workspace's managed `aomi-dev` workflow.

```bash
pnpm --filter telegram dev        # Vite on PORT, default 3000
pnpm --filter telegram typecheck  # Generate native route types, then check
pnpm --filter telegram build:app  # Build after shared-package prerequisites
pnpm --filter telegram start      # Run the copied Node artifact
```

Node builds produce `.output/server/index.mjs` and `.output/public`; Vercel builds
use the Nitro Vercel preset. The deployment has one page (`/`) and one explicit
HTTP binding (`POST /api/telegram/launch`). Unsupported launch methods return
405, and its automatic OPTIONS response advertises `OPTIONS, POST`. Trailing
slashes redirect with 308 while preserving the query and request method.

Outside Telegram there is no `initData`, so the ceremony stops after the first
stage — enough to work on layout, not enough to exercise the flow. Privy's
iframe is also blocked on `localhost` by its `frame-ancestors` policy, which
only names the deployed origins.

```bash
pnpm --filter telegram check   # typecheck → lint → test → build
```

## Design

The UI is built from the Aomi design system exactly as the portal is:
`@aomi-labs/widget/themes/default.css` for tokens and
`@aomi-labs/widget/components/ui/*` for primitives, so the two surfaces
cannot drift. Only the light/dark _choice_ is taken from Telegram.

The Telegram Web App script loads before hydration. Server HTML includes the
initial wallet ceremony or the missing-configuration card; launch verification,
Privy, and wallet hooks load through a browser-only lazy boundary. A server
render never invents a Telegram identity or a verified launch. Router-owned
search parsing preserves opaque bot and session identifiers as strings.

Each router owns one QueryClient and its provider. Private account queries and
mutations are excluded from SSR dehydration; only successful queries explicitly
marked `ssrSafe` may serialize.

**widget-lib pins Privy v2 while this app runs v3.** Its UI primitives are
Privy-free and safe; nothing under `providers/` or `lib/wallet-kit` may ever be
imported here. `test/invariants.test.ts` enforces that.
