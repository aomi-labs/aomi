# Settings redesign — stub gaps to fill

Branch `worktree-settings-redesign`. The portal settings surface was reduced to
**General / Account / Usage** (+ a standalone `/statement` page), styled to the
aomi design system (sky accent, pink decorative meters, flat/no shadows, PT
Serif display). Where the backend surface didn't exist yet, the UI renders
from clearly-marked fixtures. This is the fill-up list.

## Account tab (`src/features/account/`) — **wired 2026-07-26, UI restyle 2026-07-30**

The tab renders from live endpoints (`account-api.ts` + `use-account-acl.ts`);
`fixtures.ts` is no longer referenced and is kept only as the design reference.
The **visual layout** now matches `aomi-portal` (grouped wallet rows, provider
avatars, inline status, radio signing modes, grant revoke inside expanded rows).

| Was | Now |
|---|---|
| Wallet rows from `seedWalletPolicies` | `GET /api/account` — `user_accounts` supplies ownership/provider metadata and `signing_policies` supplies durable permitted behavior. Auto availability is derived by joining an auto policy to an active exact-address delegation. |
| Grants from `seedGrants` | `GET /api/account` — `delegated_accounts` supplies provider, exact-address scope, and explicit lifecycle status. |
| Mode change simulated in local state | Real permit ceremony: `challenge` → `signTypedData` (EVM) / `signSolanaMessage` (SVM) → `commit`, then a refetch. **Nothing is optimistic** — the row flips only on the committed backend value |
| Revoke / "stop all" mutated local state | `DELETE /api/account/providers/:provider/grant`, per provider identity (that's the revocation unit — it clears the identity's vault secrets) |
| Endpoint-only layout (cards, grants section, status band) | Mock layout: custody groups in one bordered container per group, `WalletPolicyRow` + `SigningModeList`, attention strip, flat "Revoke all", unbound → **Activate** (bind) |
| Wallet brand tags never rendered | Provider logos via `wallet-brands.tsx` — Para/Privy from `linkedVia`, MetaMask/Phantom/etc. when `rdns` is on the wire, adapter `walletName` for unbound rows; generic icon fallback |

Behavior worth knowing:

- **Direction is pre-checked client-side** (`isLoosening`, matching the kernel's
  `SigningMode` rank ladder) purely to *explain* the requirement before the
  wallet prompt: loosening needs the wallet itself, tightening accepts any
  linked key. The backend re-decides — this is UX, not enforcement.
- **`provider_managed` keys** offer only `auto`/`denied` (no user key material),
  matching the backend's Loosen→Tighten relaxation for them.
- **SVM commits name their signer** (`signer` field) because Ed25519 has no
  recovery.
- **Active grants hint** under "Wallet signing" when live grants exist — expand
  a wallet to revoke (replaces the old standalone grants list).

Still open here:

| Gap | Today | Real binding |
|---|---|---|
| "Re-grant" on a drifted wallet | `openAccountUI()` then refetch | There is no server-side re-grant — grants are born only from the provider's verified connect flow. A dedicated re-consent route would make this deterministic instead of "send the user back to the provider and hope" |
| `rdns` on self-custody wallets | Para/Privy logos always; MetaMask/Phantom only when API returns `rdns` | Capture EIP-6963 `rdns` / wallet-adapter id at connect, persist to wallet `displayMetadata`, return via account API |
| Grant `kind` copy | `grantKindLabel()` display map | Settle grant_kind enum copy on the backend |

## Usage tab + `/statement` (`src/features/usage/`) — **model subject wired 2026-07-26**

Both surfaces now read `GET /api/account/statement?from_date&to_date` (new
backend endpoint; `aomi_account::model_statement` over `llm_usage_events` —
the only table that keeps the model dimension; the daily rollup drops it).
`statement-api.ts` adapts the wire onto the existing `MonthlyStatement` shape,
`use-usage-statement.ts` fetches per month key with a session cache.
`fixture.ts` is unreferenced — kept as the design harness for the sections
that can't be real yet.

The honesty rule that shaped this: **a subject with no ledger writer renders
as absent ("—"), never as $0.00.** The types already encoded it
(`tool: AppToolUsage | null`), the views now respect it.

| Was | Now |
|---|---|
| Per-app matrix + per-model rows | Real — per app × model × payment method, turns/tokens/credits/USD (`AomiCredit::to_usd`, no FE pricing constant) |
| Monthly history | Real — month picker fetches per range; last 6 months offered |
| Payment strip | Real for the current month — allowance position from the profile's embedded `UsageStats`, x402 settlement from `paid_credits` on stream-method legs. Hidden for past months (the profile's position is only exact for the current one) |
| BYOK marking | Real — an app whose lines are all `payment_method: "byok"` shows "paid by your own key" and `billed: false` |
| `/statement` identity header | Real — email/user id + public key from `/api/account` |

Still open here (all blocked on ledger writers, not on FE/endpoint work):

| Gap | Blocker |
|---|---|
| Section tool-use (B) | Nothing writes `statement_entries` with `subject: "tool_invocation"` — the x402 client isn't built. `tool_invocations` has real call counts but no price |
| Section outcome/on-chain (C) | Same — no `subject: "outcome"` writer, no fee legs (flow/bps/feeToken) on `user_transactions` |
| Base-vs-charged markup split | Not recorded per event; `base` mirrors `charged` until the ledger carries the split |
| Statement history beyond 6 months | Trivial (raise `monthCount`) once anyone needs it |

## Packages modal — **wired 2026-07-26**

Catalog from `GET /api/account/apps` (real `AppSpec[]`); installed state from
the profile's `user.apps`; install/remove via the new `PUT /api/account/apps`
(full-replace of `users.applications`; backend validates names against the
account's own visible catalog, so a bearer can't self-grant an unseen app).
Not optimistic — rows flip on the PUT response. `"default"` is pinned ("Built
in", not removable). Brand decoration (icons/colors/categories/copy) is a
client-side `DECOR` map keyed by app name until `AppSpec.metadata` carries
display fields; undecorated apps render a neutral monogram under "More".

## General tab (`src/features/general/`)

- **Default network** row is display-only (shows connected chain ticker); no setter is wired.
- **Disconnect** uses `adapter.disconnect` when the wallet kit exposes it, else falls back to `openAccountUI` labeled "Manage wallet".
- Theme row writes `useSettings().colorMode` (`dark`/`light`/`auto` = Dark/Light/System) — fully wired.

## Removed with the redesign

Deploy, App Keys, Bots, Secrets, BYOK tabs; `features/{apps,app-keys,bots,secrets,byok}`, `components/settings/deploy-settings.tsx`, `lib/usage-range*` deleted. Deployments continue to live at `/deployments` (GitHub-return params on `/settings` still forward there). If any retired tab must survive, it needs a new home — the redesign intentionally does not carry them.

## Test coverage

`settings-route-callers.test.tsx` covers GeneralSettings (`/api/account`).
Account: `features/account/account-acl.test.tsx` (routes + permit ceremony +
error translation). Usage: `features/usage/statement-api.test.ts` (adapter) +
`usage-settings.test.tsx` (route caller + absent-subject rendering).
Packages: `components/shell/packages-modal.test.tsx` (catalog + PUT replace +
pinned app). Backend: `model_usage_groups_per_model_and_scopes_to_the_user`
in `aomi/crates/database/tests/entities.rs`.

## Round 2 — chat-shell adoption (popup settings, packages, theme, sidebar)

- **Settings is now a popup** (`components/settings/settings-modal.tsx`) opened
  from the chat header. The full-page shell (`settings-layout.tsx`,
  `settings-sidebar.tsx`, `settings-runtime-provider.tsx`) is deleted;
  `/settings` is a redirect stub that forwards GitHub-App query params to
  `/deployments` and everything else to `/`.
- **Packages modal** (`components/shell/packages-modal.tsx`) is the design
  catalog with a hardcoded package list and local install state. Real bindings:
  app catalog from `/api/thread/apps` / admin app-store, per-account install
  state, icons via app metadata.
- **Theme switch** in the header toggles `useSettings.colorMode` light/dark;
  "System" remains selectable from Settings → General.
- **Sidebar** restyle lives in `apps/shadcn-registry` (thread-list +
  threadlist-sidebar) and uses the portal-defined `--aomi-*` tokens. Other
  widget-lib consumers (landing, embedded widget) don't define those tokens
  yet — promote them into `@aomi-labs/widget-lib` theme CSS before shipping
  beyond the portal.

## Round 4 — conversation surface + widget-lib token promotion

- The `aomi-*` tokens now live in the **shared widget theme**
  (`apps/shadcn-registry/src/themes/default.css`), so landing and embedded
  consumers resolve them too — the round-2 caveat is closed. The portal's
  `globals.css` keeps only its `--font-display` mapping.
- Conversation surfaces restyled to the mock inside the registry (thread
  empty state + hero composer + chips, user bubble, assistant AomiMark rows,
  working-trace card, dock composer). All streaming/animation behavior kept.
- Frame header is the mock's (border-b, thread title, right cluster); the
  real `NetworkSelect` renders as the header pill from portal
  `HeaderControls` (`hideNetwork` set on the composer control bar); the
  sidebar footer wallet bar is the mock account chip. Credits in the chip
  (mock shows "1,240 credits") still need an account-overview feed into the
  widget — today the second line is wallet network detail.
- Remaining conversation gaps vs the mock: tx-preview card (the mock's
  "Swap preview" card is a working-trace/tool-interpreter presenter concern,
  not yet restyled as a standalone card) and the mock's one-line dock
  composer Plus button (attachments) which we deliberately did not fake.

## Round 3 — token sweep + rebuild

The redesign surfaces are now built exclusively on the `aomi-*` design-token
namespace (full semantic set in portal `globals.css`, mirroring
~/Code/aomi-design tokens: bg/surface/surface-2/raised/border/fg/muted,
accent(+strong/subtle/on), hover, pink, success/warning/danger/info; light +
dark). Mock components port 1:1 (`bg-surface` → `bg-aomi-surface` …) with no
shadcn-vocabulary mixing. `SignerMode` resynced to the mock's current values
(`manual` / `client_auto` / `auto` / `denied`). The modal panel geometry is
inline-styled (immune to Tailwind arbitrary-class scanning misses).


## 2026-07-26 — design-system gaps closed

All five gaps from the component inventory are resolved; see specs/STATE.md
for the full rule set.

1. Focus ring — `--aomi-ring` + a zero-specificity `:focus-visible` rule in
   the widget theme.
2. Accent gradient — gone; "Sign to authorize" is the flat blue solid.
3. Alpha tints — `accent-tint` / `accent-outline` / `overlay-border` tokens;
   no raw opacity utilities left in the redesigned surfaces.
4. Selection grammar — split by size (pill = solid accent, card/row =
   accent-subtle + accent icon).
5. shadcn seam — tokens live in @aomi-labs/widget-lib; session panel, thread
   list, composer and the wallet-sheet shell all speak `aomi-*`.

REMAINING: the wallet picker's interior rows (wallet-picker.tsx, ~2.3k lines)
are still shadcn vocabulary — `bg-card`, `border-border/70`, `hover:bg-accent/40`,
`border-destructive/30`. Only its shell was refitted to the modal standard.
That file is the next sweep.


## 2026-07-26 — build app (apps/build) aligned to the same token vocabulary

The control plane had its own `aomi-*` namespace in
`apps/build/src/app/aomi-design-tokens.css`, separate from the widget theme.
Checked first: the primitive ramps are byte-identical to the widget's
(sky 50-500, cool 0-950), and the build app does NOT import the widget theme
CSS, so nothing was colliding at runtime.

Done (additive — no existing value repainted):
- Canonical names added to the build token file, derived from the ramps it
  already had: `--aomi-fg`, `--aomi-muted`, `--aomi-surface-2`, `--aomi-raised`,
  `--aomi-hover`, `--aomi-accent-strong`, `--aomi-on-accent`,
  `--aomi-danger-strong`, `--aomi-on-danger`, `--aomi-ring`,
  `--aomi-accent-tint`, `--aomi-accent-outline`, `--aomi-overlay-border`
  (light + dark).
- `@theme inline` in build's globals.css now maps `--color-aomi-*`, so
  `bg-aomi-surface-2`, `text-aomi-fg` etc. work there exactly as in the portal.

DIVERGENCE LEFT FOR A HUMAN CALL: `--aomi-surface` means different things.
Build resolves it to cool-0 (#ffffff); the widget theme resolves it to cool-50
(#fafafa). Build maps it to `--surface-1`, which is used widely, so changing it
would repaint panels across the control plane. `--aomi-accent` also differs
(build sky-300 vs widget sky-500) but is unused in build — the utility above is
wired to `--aomi-accent-interactive` (sky-500), which matches the widget.

NOT DONE: build components still use their own semantic layer (`--surface-1`,
`--text-primary`, `--brand`) and shadcn utilities across ~42 files. The tokens
now line up; converting the class vocabulary is a separate sweep.
