# Sol Dottie

The landing page and live desk for Sol Dottie, the Solana sidekick we build in
the "Ship a Financial Agent in an Hour" clinic (Solana Hacker House London,
Breakpoint 2026). Built from the `dottie.html` concept design.

The desk has two modes:

- **Live**: with an Application ID, the middle column is the real
  `@aomi-labs/widget`, Solana wallets only (Phantom, Solflare, Backpack, Glow),
  pinned to the Dottie App. The playbook cards put a starter prompt in the
  composer without sending it.
- **Concept**: without one (or with `?concept` in the URL) it shows the
  original sample-data conversation. Nothing touches a wallet.

```sh
pnpm --filter @aomi-labs/example-sol-dottie... --filter '!@aomi-labs/example-sol-dottie' run build  # widget + deps
pnpm --filter @aomi-labs/example-sol-dottie dev        # http://localhost:3004
open "http://localhost:3004/?application_id=<id>"      # live desk against any App
```

The production build needs more heap than Node's default:
`NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @aomi-labs/example-sol-dottie build`.

## Config

Public defaults live in `src/site-config.ts`; a Vite env var of the same name
(`.env.local`, see `.env.example`) overrides each:

| Variable | Meaning |
| --- | --- |
| `VITE_DOTTIE_APPLICATION_ID` | Hosted Dottie App. Empty means concept mode. |
| `VITE_AOMI_API_URL` | Aomi backend. Empty means `https://chat.aomi.dev`. |
| `VITE_DOTTIE_TELEGRAM_URL` | Telegram bot link for the "Meet me on Telegram" buttons. |

## Deploy

`.github/workflows/deploy-sol-dottie.yml` builds this app and publishes `dist/`
to the Cloudflare Pages project `sol-dottie` (https://sol-dottie.pages.dev) on
every push to `main` that touches it. Run it by hand from the Actions tab on
any branch to get a preview deployment at `<branch>.sol-dottie.pages.dev`.

It reads from the `sol-dottie` GitHub Environment:

- secret `CLOUDFLARE_API_TOKEN`: a token with **Account › Cloudflare Pages ›
  Edit**. Set it with `gh secret set CLOUDFLARE_API_TOKEN -e sol-dottie`.
- variable `CLOUDFLARE_ACCOUNT_ID`.
