# Telegram bot data model

Decided 2026-09-22 (Cecilia + Claude grilling session). Pairs with the same
file in product-mono on branch `codex/tenant-telegram-config`. Both branches
are rewritten in place; there is no rollout, compatibility read, or data
migration to preserve.

## Entities

```
builder ──< bot_registrations >──< bot_registration_apps >──< applications
                 │
                 └── handover_app_id ──> applications   (renamed from default_app_id)

bot_thread_selections (bot_registration_id, thread_id) ──> applications   (the bot's per-thread app pick)
```

- One builder owns many bots and many apps. One bot maps many apps. One app is
  mapped by many bots.
- A bot is the identity: one bot token, one owner, one Mini App URL, one command
  endpoint, one command list, one handover app.
- The `owner_user_id` account path and `POST /api/account/bots` are left exactly
  as they are. The new fields are settable only through the builder (manager)
  routes; account-owned rows simply have them null.

## Columns

`bot_registrations`

| column             | type     | rule                                                        |
| ------------------ | -------- | ----------------------------------------------------------- |
| `handover_app_id`  | bigint   | renamed from `default_app_id`. Picks the operating account for a handover AND is the app a new chat starts on. UI label: "Handover app — new chats start here". |
| `mini_app_url`     | text ∅   | null = platform default `AOMI_TELEGRAM_DEFAULT_MINI_APP_URL`, resolved at read time, never stored. |
| `command_endpoint` | text ∅   | null = custom commands unsupported. Commands post to `{command_endpoint}/{command}`. |
| `commands`         | text[]   | not null, default `'{}'`. Bot-level, no per-app override. |

`bot_thread_selections` (new table, bot-owned)

| column                | type   | rule                                                  |
| --------------------- | ------ | ----------------------------------------------------- |
| `bot_registration_id` | text   | PK part, FK bot_registrations ON DELETE CASCADE.      |
| `thread_id`           | text   | PK part. The runtime thread the pick applies to.      |
| `application_id`      | bigint | FK applications ON DELETE CASCADE. Written by `/app`. |
| `updated_at`          | bigint |                                                       |

The runtime resolves the app per request and never persists it: the client
remembers and re-states it every turn. The bot is the client for its users, so
the memory is bot-owned (`BotThreadService::select_app` / `selected_app`, a
read-through cache filled when a thread is resolved). `DbThread` and the
runtime's own resolution are untouched.

`applications.metadata.telegram` is removed as a concept: delete
`DbApplication::set_telegram_config` and the reader in `apps_for_bots`.

`configuration_version` bumps on any write to the four bot columns or the
mapped-app set, so a live `TelegramBot` reloads its config.

## Validation (manager is the only authority)

- URL fields: `https:` or `http://localhost`; no userinfo, query, or fragment;
  trailing slashes stripped. `""` is treated as `null`.
- Commands: at most 32; each `[a-z0-9_]{1,32}` after trim, leading-slash strip,
  lowercase; unique; not reserved.
- Non-empty `commands` requires `command_endpoint`. An endpoint with no
  commands is allowed.
- Reserved list is one const `RESERVED_BOT_COMMANDS` in `aomi-bot-core`,
  containing exactly the registered Telegram panel commands (`start`, `wallet`,
  `transactions`, `app`, plus any alias a panel registers). A test in the
  Telegram crate asserts every registered panel command is in it. `signing`,
  `help`, `sign`, `thread`, `model` leave the list.
- The BFF checks shape only (string / array) and forwards the backend's `error`
  string to the UI. No mirrored rules in TypeScript.

## Per-bot command secret

- `secret = hex(HMAC-SHA256(AOMI_TELEGRAM_COMMAND_SECRET_BASE, bot_registrations.id))`.
  Nothing stored, no rotation, no version column. The env var replaces
  `AOMI_TELEGRAM_TENANT_SECRET`.
- Request to the partner: headers `x-aomi-timestamp`, `x-aomi-signature`
  (`sha256=<hex>` over `timestamp || "." || body`), and new `x-aomi-bot-id`.
  Body gains `bot: { id, username }`.
- Reveal: manager `GET .../user/bots/:id/command-secret` (same ownership check
  as update), BFF `GET /api/operate/bots/:id/command-secret`, SDK method, UI
  "Reveal" control on the bot card in edit mode. Not returned on create. Never
  logged.
- Webhook health: registration asserts `setWebhook` once, and anything holding
  the token can `deleteWebhook` behind Aomi's back (a stale poller did this to
  @chico_chico_bot on staging), leaving the row `active` with its
  `webhook_url` intact while Telegram delivers nothing. So the manager
  re-asserts the webhook after every bot config save (PATCH) and reports a
  failure as `webhook_warning` beside the saved row, never as a failed save.
  `POST .../user/bots/:id/webhook` (same ownership check as update) calls
  `getWebhookInfo`, returns `{ url_matches, pending_update_count,
  last_error_message, reasserted, warning? }` (never the token, secret or
  URL) and re-asserts on a mismatch. BFF `POST /api/bff/operate/bots/:id/webhook`,
  SDK `checkUserBotWebhook`, UI "Check webhook" on the bot card in read mode.

## Runtime rules

- `/wallet` opens the effective `mini_app_url` with `?bot_id=&session_id=`.
  There is no `/signing` sub-path any more; a partner points `mini_app_url` at
  whatever page handles those params. The Aomi default (`apps/telegram`) already
  reads both.
- A command reply button must sit under either configured base (origin and
  path prefix match against `mini_app_url` or `command_endpoint`).
- Thread app resolution: the bot tells the runtime, never asks it. The bot's
  own pick (`BotThreadService::selected_app`) if it is still mapped to the
  bot, else `handover_app_id`, stamped onto every `RuntimeAppRequest`.
- `/app` panel is restored in the same PR: lists the bot's mapped apps, writes
  the pick through `BotThreadService::select_app`, and is refused while a
  handover is active on that thread. Handover keeps picking the operating account from `handover_app_id`.
- The runtime trusts the row. It does not re-check ownership or rules.

## API and SDK shape

- Manager builder create/update accept `mini_app_url`, `command_endpoint`,
  `commands`, `handover_app_id`. Omitted = unchanged; `null`/`""` clears a URL;
  `[]` clears commands.
- Bot wire returns the stored values (`mini_app_url: null` when default) and
  `handover_app_id`. `BotRegistrationApp` loses `tenant_base_url`/`commands`.
- Deploy SDK: `miniAppUrl`, `commandEndpoint`, `commands`,
  `handoverApplicationId` (replaces `primaryApplicationId`), and
  `revealBotCommandSecret`. Bump the package version.
- "Tenant" leaves all identifiers. Code says `command_endpoint`,
  `CommandReply`, `command_secret`. Prose may still call World a tenant.

## Widget UI (bot card only)

- Edit mode: Mini App URL (placeholder names the Aomi default), Command
  endpoint, Commands, Reveal secret, app checklist with the "Handover app"
  radio. Save/Register disabled when commands are set without an endpoint.
- Read mode: one line showing the effective Mini App URL, the endpoint, and
  `/commands`.
- Fields are seeded from the bot, not from an app. Only edited fields are sent
  on save.
- Copy: "Custom commands are handled by the bot's command service, without an
  agent turn." The radio note: "new chats start here".

## E2E harness (scripts/world-e2e)

- `seed.sh` writes the four bot columns instead of app metadata. `mini_app_url`
  points at World's existing local signing page so World code is unchanged.
- `up.sh` exports `AOMI_TELEGRAM_COMMAND_SECRET_BASE` and
  `AOMI_TELEGRAM_DEFAULT_MINI_APP_URL`, computes the derived secret in shell
  from the seeded bot id, and hands it to the World service.
- The Rust integration test seeds through the bot row and sets the base secret
  itself.

## Out of scope

Secret rotation, removal of the account-owned bot route, rollout or
compatibility shims, a separate signing URL, per-app command overrides.

## Work plan

product-mono (`codex/tenant-telegram-config`)
1. Migration: rename `default_app_id`, add the three bot columns, add
   `bot_thread_selections`.
2. Delete `set_telegram_config` and the metadata reader; move fields onto
   `DbBotRegistration` / `NewBotRegistration`.
3. Manager: canonicalise into the row on create/update; reserved const in
   bot-core; secret reveal endpoint; wire rename.
4. Telegram crate: move URL/commands/secret off `RegisteredBotApp` onto
   `RegisteredBotConfig`; derived secret + new header/body fields; `/wallet`
   URL; button rule; restore `/app`; persist selection; handover guard.
5. bot-core: `BotThreadService` owns the durable pick; runtime untouched.
6. Harness, docs (`registered-telegram-bots.md`, env-vars facts), tests.

aomi-widget (`codex/tenant-telegram-config`)
1. `packages/deploy`: types, wire, client method, version bump.
2. BFF operate routes: shape-only checks, forward backend error, secret route.
3. `bots-view.tsx`: fields on the bot, dirty-tracked save, reveal, copy.
4. Tests for all three.
