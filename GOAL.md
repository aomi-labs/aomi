# Canonical Landing

Current session goal: **CLI SDK PARITY AND WALLET EXPORTS VERIFIED 2026-09-08**
— replace the obsolete flat Pipeline CLI with a compact filesystem, scoped
operation, and EVM/SVM Build lifecycle interface backed by the canonical SDK;
restore EIP-5792, MegaETH MOSS, and MetaMask Agent Wallet handoff artifacts on
the Action model; remove orphaned pre-Action signing code; and align the CLI
documentation and package release. Verified with client and backend Pipeline
tests, typecheck, lint, production package build, built-CLI smoke checks, and an
npm dry-run tarball audit for `0.6.13`.

Current session goal: **LEGACY AGENT TRACE GROUPING VERIFIED 2026-09-07** —
group null-turn historical Agent tool steps and final answers by their preceding
user message while preserving canonical turn identities and stable pagination.

Current session goal: **LEAN PAYMENT REVIEW FRONTEND CONSUMER FIXES VERIFIED
2026-09-06** — SDK BYOK routes and response shapes use `/api/account/model-keys`,
Agent and CLI calls can explicitly select `user_byok`, Portal credit top-ups
retain one account-scoped idempotency key through uncertain outcomes, and the
Portal uses the shared SDK credit transport and x402 signer. Client/React/Portal
typechecks, focused tests, package builds, and npm dry-run audits pass.

Current session goal: **PAYMENT BOUNDARY REVIEW FIXES VERIFIED 2026-09-04** —
paginate complete monthly statements, report allowance and Credit Bank debits as
separate account-funding buckets, classify anonymous widget principals as
guests, derive receipt explorers from the settled network, and return the final
bounded x402 challenge to callers. The branch is rebased onto the OAuth refresh
fixes on `main`, preserving `offline_access` and refresh-resource inheritance.
Portal/client tests, lint, formatting, and typechecks pass. The publishable
client is patch-bumped to `@aomi-labs/client@0.6.11`.

Current session goal: **LEAN PAYMENT BOUNDARY IMPLEMENTED AND LOCALLY VERIFIED
2026-09-03** — move public execution admission, customer-rate accounting, and
Credit Bank ownership into api-server; persist correlated raw usage before
completion; remove runtime pricing and child admission; and expose the paired
account, SDK, CLI, OpenAPI, and Portal contracts. The payment-aligned Credit
Bank disclosure and top-up review UI are restored, with one credit as the
minimum purchase. Capped Rust and TypeScript checks, focused Portal/client
tests, a live Base Sepolia one-credit x402 settlement, idempotent replay, and
database postconditions pass. The publishable client is patch-bumped to
`@aomi-labs/client@0.6.10`; paired backend and frontend draft PRs are prepared
for review. A final behavior-preserving cleanup removed the duplicate Diesel
lease projection, centralized UTC billing-month calculation, moved lease
acquisition onto its owning payment service, and split both oversized Portal
account/payment components below the 500-line limit. Rust fmt, clippy, compile,
and 201 affected-package tests pass; Portal typecheck and 457 tests, client
typecheck/build and 265 tests, plus the widget build and 93 changed/artifact
tests pass with capped concurrency.

Current session goal: **PROVIDER AND DEVICE AUTH RECOVERY LOCALLY VERIFIED
2026-09-02** — `/device-auth` and `/oauth/device` now select Para or Privy at
the single root wallet-provider boundary, OAuth device decisions claim and
display the request before approve or deny, dynamic registration admits only
the supported public MCP authorization-code and REST device-client shapes, and
legacy CLI grants/link intents use encrypted five-minute one-time
`ba_verifications` records instead of process-local maps. Portal lint,
typecheck, all 468 tests, 139 account tests, and six disposable-PostgreSQL
integration tests pass, including real Agent REST and Pipeline REST Better
Auth flows from DCR through authenticated claim, approval, and token. Public
clients are exact-resource-bound without widening resource-less Codex
registration, and provider/link records survive cross-instance exchange with
atomic replay protection. Live provider credentials and staging were
intentionally not exercised in this isolated implementation slice.

Current session goal: **CLI AGENT CHAT AUTH, ORDER, AND TOOL TRACES VERIFIED
2026-08-31** — anonymous Agent and Pipeline calls now receive a guest bearer
even while additive account auth is configured, the CLI persists that guest
identity across processes, and resumed chats skip prior-turn output. Current
wire-format `message` tool results render in both React and verbose CLI output
without duplicating future typed tool events. Device-only OAuth registration no
longer declares an unused redirect flow. Client and React builds, typecheck,
lint, formatting, 259 focused package tests, 44 Rust runtime tests, and repeated
live staging CLI tool calls pass with message, tool, answer, and terminal order.

Current session goal: **GUEST SELF-CUSTODY API AND SDK FIXES VERIFIED
2026-08-30** — guest Agent sessions can resolve their own staged actions and
guest Pipeline sessions can execute self-custodial operations without gaining
delegated custody or payment authority. Node clients now reuse Better Auth's
opaque guest bearer directly, local widget origins can bootstrap against hosted
Portal environments, third-party widget origins no longer conflict with the
internal anonymous sign-in, and the Portal exposes the Pipeline root, OpenAPI,
and API catalog routes backed by api-server. Client/account/Portal typechecks,
scoped lint, the client build, 431 tests, and a live staging guest Agent plus
Pipeline catalog smoke pass.

Current session goal: **LEGACY AGENT TOOL TRACE PROJECTION VERIFIED
2026-08-30** — React now projects the Agent ledger's current tool-bearing
`message` events into Assistant UI tool-call parts with the backend tool name,
arguments, and parsed result. Typed `tool_complete` events take precedence for
the turn, so the compatibility path does not duplicate traces after the backend
cutover. Focused React tests, library typecheck, lint, formatting, build, and
package dry-run inspection pass.

Current session goal: **CANONICAL CROSS-CHAIN ACCOUNT MODEL IMPLEMENTED AND
LOCALLY VERIFIED 2026-08-26** — portal account settings and the TypeScript
client consume the single `GET /api/account` `AccountProfile` response. Legacy
wallet/grant routes and fields are removed from consumers while signing mode
changes, exact-address delegation history, revoke/regrant, Para agent
provisioning, drift warnings, and SVM binding remain intact. Portal tests,
typecheck, focused ESLint/Prettier, client build, and generated OpenAPI contract
checks pass. No package was published and no hosted database was changed.

Current session goal: **PRIVY LOGIN POLICY DRIFT FIXED 2026-08-30** — the
portal no longer hard-codes login methods into Privy's modal. The Privy app
configuration is now the single authority, so disabled providers such as
Google cannot be advertised and fail with `disallowed_login_method`. The
portal suite, typecheck, lint, and a focused provider-config regression pass.

Current session goal: **FULL-BLEED FOOTER BOUNDARY VERIFIED 2026-08-30** — the
blue footer now stays flush with every viewport edge and the decorative
atmosphere layer ends at the real landing-content boundary instead of extending
the document below the footer. Playwright checks at 390px, 1440px, 2048px, and
3090px confirm zero visible bottom or side gaps, no horizontal overflow, clean
console output, and retained animated canvases.

Current session goal: **HOMEPAGE PRIORITY COPY AND LINK AUDIT VERIFIED
2026-08-29** — applied the approved homepage language updates from the latest
`main`, routed the primary conversation CTA and team CTA to Contact, and removed
link treatment from homepage references that do not yet have supporting pages.
Desktop and 390px browser checks confirm the updated copy, working Contact
navigation, the plural Resources label, no false `#` links, and no horizontal
overflow. Landing TypeScript, ESLint, production build, and `git diff --check`
pass.

Current session goal: **EXTERNAL WALLET RELOAD PERSISTENCE VERIFIED
2026-08-26** — external EVM wallets now persist and silently reconnect across
portal reloads even when the durable Aomi account session is enabled; hosts can
still opt out explicitly, and an actual wallet disconnect remains disconnected.
The Solana adapter already restores through its native `autoConnect` path.
Wallet-kit regression tests, package build, portal TypeScript, scoped ESLint,
Prettier, and `git diff --check` pass. The unrelated pre-existing
`execution-runtime.test.ts` receipt-wait fixture still times out in the full
suite; all other 358 wallet-kit tests pass.

Current session goal: **NON-HOMEPAGE GTM COPY ALIGNMENT VERIFIED 2026-08-26**
— updated the approved language across About, Human Interface, Agent Toolings,
REST APIs, Plugin SDK, Trading, DeFi, Fintech, Wallets, and Contact while
preserving every page's audience-specific GTM, components, layout, styling,
interaction, and animation. All ten routes return 200 with the approved copy;
Playwright checks at 1440px and 390px confirm the intended headings and zero
horizontal overflow. The landing production build, TypeScript, ESLint,
Prettier, and `git diff --check` pass.

Current session goal: **AGENT TOOLINGS COMPOSITION POLISH VERIFIED
2026-08-26** — restyle the Choose Your Surface flow cards with the same flat,
compact visual language as the Simulate and Sign stages, then move the section
heading and support copy into the unused space above the execution path so the
three input cards can begin immediately and the whole section becomes shorter;
on desktop, place the title in the rightmost intro column above Simulate and
Sign, with the supporting copy to its left above the harness. Keep the
Interactive Setup code surface at one compact height across Skills, MCP, and CLI
while tightening the internal vertical gaps. Browser measurements confirm all
three setup states remain exactly 560px tall with their full desktop transcripts
visible, the title occupies the rightmost desktop intro column, and the 390px
layout has zero horizontal overflow. Scoped ESLint, Prettier, and
`git diff --check` pass.

Current session goal: **TRADING HERO REFERENCE LAYOUT VERIFIED 2026-08-26** —
matched the supplied hero composition with the large Integrations screen on the
upper-left, the Build/Create screen overlapping from the lower-right, and the
copy column on the right; removed the unreferenced proof rail and preserved a
copy-first, overflow-safe mobile stack. Desktop and 390px browser checks confirm
the requested hierarchy, overlap, dark presentation, and mobile containment.

Current session goal: **WORLD MARKETS MOTION AND DARK TELEGRAM POLISH VERIFIED
2026-08-26** — animate the World and Telegram marks around the orbit while
keeping them upright, simplify the handoff title to “Connect your world
account,” make the dark Telegram fixture read like a real Telegram window, and
replace the bright mandate cards with muted dark surfaces and white text.
Browser checks confirm changing orbit transforms, upright moving badges, the
updated account title, distinct Telegram-dark incoming and outgoing surfaces,
and muted authority and enforcement cards. Landing TypeScript, scoped ESLint
and Prettier, and `git diff --check` pass.

Current session goal: **TRADING HERO COPY AND PADDED BUILD PROOF VERIFIED
2026-08-26** — split the Trading hero into “Automate trading with ready-to-go
integrations” and the subtitle “plus expanded action space,” replaced the rear
Build screenshot with the supplied narrower Create view, and kept the layered
proof inside deliberate page padding instead of bleeding across the viewport.
Desktop and 390px browser checks confirm the requested copy hierarchy, readable
rear and foreground screens, deliberate side padding, and an overflow-safe
mobile stack. Landing TypeScript, scoped ESLint and Prettier, asset dimensions,
and `git diff --check` pass.

Current session goal: **SUBPAGE HERO SCALE AND SETUP CONTROL POLISH VERIFIED
2026-08-26** — removed the redundant Agent terminal label, sized the Agent
Toolings segmented selector to the shared 46px button token, split the DeFi hero
into a concise title and mandate subtitle, and tied every subpage hero to the
homepage scale across desktop, tablet, and mobile. Browser checks covered 15
product, solution, pricing, company, and research routes at 1440px and 390px;
none exceeds the homepage hero, the selector slides through all three states,
and the DeFi mobile route has zero horizontal overflow. Landing TypeScript,
scoped ESLint and Prettier, and `git diff --check` pass.

Current session goal: **DARK-MODE VISUAL POLISH VERIFIED 2026-08-26** —
remove the homepage FAQ hover wash, eliminate the four nested-radius crescents
around the Human Interface demo, stop global pressed-button styling from leaking
into widget traces, keep the footer mark and wordmark the same color, and restore
Sign-stage text contrast in dark mode. Verified in Playwright in light and dark
themes at desktop and 390px widths; landing lint and production build pass.
Current session goal: **CANONICAL LANDING IMPLEMENTATION CLEANUP VERIFIED
2026-08-25** — remove migration-era version names and generated-export
scaffolding from the one production landing implementation, give every retained
asset a semantic name, and delete unused export files without changing the
approved design, navigation, animation, or responsive behavior. The canonical
implementation now lives under `_marketing` and `assets/landing`; the homepage
keeps only six Latin font files, 30 named logo files, and three named runtime
dependencies. Desktop and 390px browser checks confirm working dropdown and
drawer navigation, all 19 mobile links, fixed navigation, no horizontal
overflow, no asset or console errors, and retained running animations. All 16
internal navigation routes return 200. Landing TypeScript, repository ESLint,
production build, authored-file Prettier, JavaScript syntax, asset-reference
integrity, and `git diff --check` pass.

Current session goal: **PRICING FAQ HEADING VERIFIED 2026-08-25** — rename the
pricing FAQ section heading from “Questions people ask.” to “FAQ”.

Current session goal: **WALLETS EXECUTION POSITIONING VERIFIED 2026-08-25** —
position the Wallets solution around protocol-agnostic execution, hosted or API
access for existing and new agentic stacks, reusable transaction harnesses, and
an access-control model with full permission guardrails, plus the component
library that renders each action.

Current session goal: **WIDGET ZERO-COST HEADLINE VERIFIED 2026-08-25** — change
the Human Interface product headline to “Zero cost integration at all product
surfaces.”

Current session goal: **PLUGIN SDK PIPELINE COPY VERIFIED 2026-08-25** — rename
the Plugin SDK build-to-deploy and managed-platform headings to “Integration
toolings & deployment pipeline” and “Developer console just like Vercel.”

Current session goal: **CONTAINED SOLUTION FACT RAILS VERIFIED 2026-08-25** —
align the Fintech and DeFi four-cell fact rails with the REST API reference:
full-width divider rules around a centered 1220px bar, consistent 120px cell
height and inset spacing, and responsive two-column and single-column states.

Current session goal: **SITE-WIDE TYPOGRAPHY GUARDRAILS VERIFIED 2026-08-25** —
replace legacy per-card 9–13px marketing copy with one semantic landing scale:
23px card headings, 16.5px body/card copy, and 14px metadata, eyebrows, and
actions. The homepage reference, product pages, solution pages, editorial
routes, legal pages, agent guides, and research shell inherit those CSS-level
roles; dense terminal, code, chart, and embedded-dashboard fixtures keep their
compact UI scale. Desktop and 360px browser audits find no undersized marketing
card headings or horizontal overflow. Scoped Prettier, landing TypeScript,
ESLint, and `git diff --check` pass; the production build reaches compilation
but cannot download Google Fonts in the current network environment. The dev
page remains available at `http://localhost:3001`.

Current session goal: **TRADING HERO PRODUCT PROOF VERIFIED 2026-08-25** —
scale the Aomi Build dashboard and Integrations screenshots into a dominant
background-and-foreground composition inspired by the supplied landing-page
reference. The proof now fills and intentionally bleeds through the right side
on desktop; its foreground screen sits lower and farther right so the Build
prompt remains visible beneath it. The composition stays clear of the editorial
copy and returns to an overflow-safe stack on mobile.

Current session goal: **TRADING UX POSITIONING VERIFIED 2026-08-25** — lead
the Trading page with ready-to-go product integrations and expanded action
space, then carry that positioning through the hero proof, metadata, World
Markets flow, and validation language while preserving “Working example” as
the explicit framing for World Markets × Aomi. The longer lead receives a
wider desktop column and headline measure; scoped Prettier, landing TypeScript,
route, and `git diff --check` pass.

Current session goal: **WALLET CHAT TYPE SCALE VERIFIED 2026-08-25** — reduce
the embedded wallet-chat fixture's oversized welcome title, prompt,
suggestions, header, and footer typography with fixture-scoped overrides, so
the published widget remains unchanged elsewhere. Browser checks confirm the
smaller 11px composer type and zero horizontal overflow; landing TypeScript,
scoped Prettier, route, and `git diff --check` pass.

Current session goal: **SITE-WIDE FLAT SLIDERS VERIFIED 2026-08-25** — the
the static homepage and React marketing routes now use one interaction model for
segmented sliders: a single shadowless blue indicator moves beneath
transparent buttons, while hover leaves both active and inactive buttons
visually unchanged. The shared liquid-glass layer can no longer reintroduce a
second hover or selected pill. Browser checks confirm the Fintech mandate,
Trading Product flow/Authority, Widget UI/Terminal, homepage UI/Terminal, and
Agent Toolings Skills/MCP/CLI controls have flat tracks, identical idle/hover
button styles, and working indicator travel; Pricing uses the same CSS model.
Landing TypeScript, scoped Prettier, all affected route checks, and
`git diff --check` pass.

Current session goal: **DEFI CALLOUT PANELS VERIFIED 2026-08-25** — apply the
reference pale-blue panel, blue left rule, dark text, and inset spacing to the
DeFi control-gap and vault-ChangeSet supporting copy without changing either
message or the styling of other DeFi section headings. Desktop and mobile
browser checks confirm both callouts render correctly with no horizontal
overflow; landing TypeScript, scoped Prettier, route, and `git diff --check`
pass.

Current session goal: **DEFI HERO FINTECH STYLE VERIFIED 2026-08-25** — align
the DeFi hero with the Fintech reference using the same quiet paper canvas,
desktop column proportions, spacing, headline measure, responsive stacking,
and rounded blue-tinted artifact border while preserving the DeFi content and
controls. Browser checks confirm the desktop composition, a 16px artifact
radius, zero 390px horizontal overflow, and no console errors; landing
TypeScript, scoped Prettier, route, and `git diff --check` pass.

Current session goal: **MANAGED BUILD DESTINATION VERIFIED 2026-08-25** — add
an end-of-pipeline section to the Plugin SDK page that positions Aomi Build as
the managed destination for deployed Apps. The supplied platform overview and
project-home screenshots are anonymized with a neutral demo identity, layered
in the requested editorial stack on desktop, and become a readable vertical
stack on mobile. The Operate headline now reads “Monitoring transactions, tool
calls, and fees with
institution-grade provision.” Browser checks confirm both images load, the CTA
targets Build, desktop overlap is intentional, and mobile has zero horizontal
overflow; TypeScript, scoped ESLint and Prettier, route and asset checks, and
`git diff --check` pass.

Current session goal: **FLAT INTERACTIONS VERIFIED 2026-08-25** — the Agent
Toolings Skills/MCP/CLI selector now uses one shadowless blue pill whose only
animation is horizontal sliding, its setup facts use regular weight, and the
REST API execution-boundary copy uses the pale-blue note-panel treatment. The
REST API source selector, homepage integration and UI/Terminal selectors,
primary navbar labels, and Plugin SDK file tree and Usage/Logs tabs no longer
change on hover; their active states remain plain and explicit. Browser checks
confirm identical idle/hover computed styles, working navigation, tab, and file
selection, and the retained selected states. TypeScript, scoped ESLint, scoped
Prettier, route checks, and `git diff --check` pass.

Current session goal: **SEGMENTED-CONTROL HOVER REMOVAL VERIFIED 2026-08-25** —
removed the hover-only color change from the Agent Toolings Skills/MCP/CLI
segmented control while preserving its selected state and tab behavior. Browser
checks confirm the unselected color stays identical before and during hover and
that MCP still selects correctly; TypeScript, scoped ESLint, Prettier, and
`git diff --check` pass.

Current session goal: **SYSTEM-ONLY THEME VERIFIED 2026-08-25** — removed the
manual light/dark control, its unused component/styles, and the layout space it
reserved from the homepage and React subpages. Theme selection now follows only
the system `prefers-color-scheme` setting, including live light/dark changes,
with no saved manual override. Browser checks confirm zero manual controls and
zero horizontal overflow on both surfaces; TypeScript, scoped ESLint, Prettier,
JavaScript syntax, route/asset checks, and `git diff --check` pass.

## Marketing dark-theme contrast

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-25** — keep
World Markets flow copy, mandate values, DeFi CTA labels, and the Pricing CTA
primary action readable when the system selects dark mode. The same components
remain readable in light mode; scoped Prettier, browser console, and
`git diff --check` pass.

Previous session goal: **NAV-MATCHED THEME SWITCHER VERIFIED 2026-08-25** —
the fixed light/dark switcher diameter exactly matched the navigation height on
desktop and mobile before the manual control was removed.

Previous session goal: **FIXED AND COMPACT MOBILE NAVIGATION VERIFIED
2026-08-25** — the static homepage navigation now remains fixed at its
22px desktop and 18px mobile viewport offsets while scrolling. Mobile
navigation is reduced to a 48px pill with a 32px homepage menu control and a
36px React menu control, tighter horizontal insets, and 20px clearance from the
homepage theme control. Browser checks confirm it stays visible at scrollY 1100
and 1800, the 19-link drawer still opens, and mobile overflow remains zero.
TypeScript, Prettier, route/asset checks, and `git diff --check` pass.

## Validation-grid official logos

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-25** — replace
the landing validation grid's letter placeholders and text-only entries with
official partner, chain, protocol, and backer artwork, while preserving its
existing labels, layout, grayscale treatment, and marquee behavior.

Previous session goal: **UPPER-RIGHT THEME CONTROL VERIFIED 2026-08-25** — the
The appearance control now lives in one fixed upper-right position, outside the
navigation, on both the static homepage and every React marketing subpage. At
phone widths the navigation reserves room for it, with no overlap or horizontal
overflow. Desktop and mobile browser checks confirm one working theme control,
functional mobile drawers, and clean spacing; TypeScript, scoped ESLint,
JavaScript syntax, all marketing route/asset checks, and `git diff --check`
pass. The current worktree is running at http://localhost:3001/.

Previous session goal: **MOBILE ADAPTATION VERIFIED 2026-08-25** — the
canonical marketing surface now reflows from 320px phones through tablet
widths instead of retaining the static homepage's 1160px desktop canvas. The
homepage has a native, touch-friendly 19-link drawer; hero/front-back install
views, validation rails, comparison content, feature cards, FAQ, and footer
stack without document-level horizontal overflow. The existing React mobile
drawer also navigates correctly. All 15 marketing routes are overflow-clean at
320px, the homepage is clean at 390px and 768px, and the 1440px desktop remains
visually identical to the approved design with all 39 motion signatures unchanged. JavaScript
syntax, landing TypeScript, scoped ESLint, route/asset checks, and
`git diff --check` pass. No obsolete versioned route copy was restored.

## Marketing light/dark theme

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-25** — apply
the Aomi design palette through semantic landing roles, honor system theme on
first visit, persist an explicit choice across the static homepage and React
marketing routes, and prevent a pre-hydration color flash. Dark-mode grids,
borders, product canvases, code samples, and the Trading/World Markets visuals
now use restrained, readable surface roles rather than leftover light colors.
The homepage and every navbar route expose the same accessible theme control;
TypeScript, scoped ESLint, Prettier, `git diff --check`, and browser checks for
toggle persistence, route continuity, contrast, and console errors pass.

# Auth BFF BetterAuth Cleanup Goal

## Mainline reconciliation

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-30** —
reconcile the canonical Agent/Event, managed OAuth, and wallet
cutover with current `main` without restoring retired chat adapters, generated
distributions, React-side lifecycle reducers, or UserState transaction
recovery. Mainline EIP-5792 export now reads complete pending EVM `Action`
records, and the retained Privy embedded-wallet lane executes through the
shared primitive wallet boundary beneath `ActionHandler`. Same-origin Agent
traffic now preserves an existing Better Auth session and creates an anonymous
cookie only after a real 401; cross-origin widgets retain their explicit bearer
flow. Exact Agent and Pipeline roots receive OAuth like their child routes.
Auto model selection now remains server-owned on Agent starts; only an explicit
manual model is sent, so guest sessions cannot drift against backend model
vocabulary. A fresh guest and the controlled logged-in Chrome profile both
complete an exact `hello` turn without returning to the start page.
The isolated FE/BFF/backend stack passed the direct Agent protocol, Pipeline API
and built CLI discovery, and rendered Action approval through a mined Anvil
transaction, terminal resume, and A-to-B-to-A session restoration. The complete
workspace check passed 1,287 tests with two intentional skips; AA passed 17
focused tests and the Para/Privy/shared execution matrix passed 64.

## Managed OAuth and canonical wallet salvage

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-30** — retain
the useful SDK/auth work from the retired cumulative release stack on top of
the canonical Agent/Event architecture. `Aomi` now owns lazy, refreshable,
resource-specific OAuth through `aomi.auth`; `new Aomi({ wallet })` exposes
the primitive wallet facade while the existing `ActionHandler` remains the
only Action lifecycle owner. Cross-origin guests receive origin-bound widget
sessions, managed widgets use a one-time WST/PKCE-bound OAuth bootstrap, and
the runnable examples exercise the canonical Agent, Pipeline, OAuth, and
Action APIs. No legacy wallet controller, auth route alias, compatibility
projection, or tracked generated distribution was restored.

## TypeScript SDK and developer surfaces

Current session goal: **IMPLEMENTED AND CI VERIFIED 2026-08-25** — ship the
final frontend/client API package on the
unified public Agent/Pipeline transport. `AomiClient` now exposes stateless,
chain-specific EVM/SVM Build lifecycles plus filesystem discovery and
runtime-schema-driven app/skill operations. The new high-level `Aomi` facade
adds fluent review-before-commit Builds, an awaitable/event-driven Agent run,
one shared EVM/SVM wallet controller, compatible action/simulation
presentation, and the `raw` escape hatch. Deprecated flat Pipeline methods
remain only for migration parity; arbitrary Catalog operation generation stays
an explicit later capability. The publishable client is patch-bumped to
`@aomi-labs/client@0.6.6`; focused negative type checks, all 271 client tests,
client lint/build, and packed-tarball inspection pass locally. Stacked PR #531
passed package CI, the complete deployed-app matrix, aggregate Frontend CI,
workflow security, and all five Vercel previews.

## Canonical Agent/Pipeline ownership cleanup

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-25** — make
Rust api-server the only public Agent/Pipeline protocol owner. Portal now limits
Pipeline MCP to exact-resource OAuth/DPoP authentication, principal narrowing,
and a thin proxy; its parallel registry, projection, payment, and execution
implementation is gone. The shared client, CLI, and React runtime use only the
generated Agent v1 transport and session API, with old chat/state/interrupt,
thread CRUD, SSE, rollback selectors, DTOs, and callbacks removed. Client and
React are patch-bumped to `0.6.5`, required distributable output is rebuilt,
and the generated contract is pinned to the cumulative backend stack head.
Client, React, Portal, Landing, and Telegram typechecks; package builds; 340
retained client/React/Portal tests (with 15 existing integration skips); lint;
and the Agent API drift check pass. The final integrated gate additionally ran
all 1,330 retained workspace tests (16 intentional skips), production builds
for Portal, Landing, and Telegram, rendered Portal/BFF smoke, both authenticated
MCP protocols, and the built CLI lifecycle. That CLI run found and fixed a
session persistence bug: creating a second session now retains the first record
instead of overwriting it, so resume and delete work across both sessions.

## Codex worktree local environment parity

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-23** — copy
ignored `.env*` files from the local checkout into Codex-managed worktrees via
the repository-native `.worktreeinclude`, and keep TypeScript setup portable by
removing the machine-specific source checkout path. Dependency setup continues
to use pnpm's shared content-addressed store rather than copying branch-specific
`node_modules`, `.next`, or other generated build outputs. A fresh detached
worktree completed install and library build, then Portal rendered `/` and
`/settings` against a fresh backend worktree with local BFF model, app, and
thread requests returning 200.

## Canonical Agent working trace

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-21** — restore
progressive tool activity in Portal turns using only the canonical Rust Agent
transport. The durable projection now preserves tool metadata and advances its
cursor only through returned backend events; the generated client contract and
`ClientSession` carry those fields into React. Focused Rust, client, React, and
Portal regressions pass, and an isolated SIWE-authenticated Playwright run showed
a live `Search web` step before the final answer with zero interrupt requests.
Follow-up reconciliation rebased both Agent branches onto current main, retained
remote thread creation and bearer/challenge protections, and made uncertain
Agent start retries reuse their operation key. The publishable client is
patch-bumped to `@aomi-labs/client@0.6.1`.

## Application-scoped discovery regressions

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-24** — keep
hosted-app discovery, model discovery, and system-event requests pinned to the
configured `application_id`, and normalize the backend's explicit artifact
availability status for partner UIs. The client is patch-bumped to
`@aomi-labs/client@0.6.1`; publishing is intentionally outside this PR.

## EIP-5792 transaction export

Current session goal: **EXPANDED AND LOCALLY VERIFIED 2026-08-24** — ship the
wallet-neutral, read-only `aomi tx export <id>...` command in
`@aomi-labs/client@0.6.2` with explicit `eip5792`, `moss`, and `metamask`
formats. EIP-5792 `wallet_sendCalls` version `2.0.0` remains the canonical and
default representation; MOSS emits the ordered call array, while MetaMask emits
the decimal chain argument and one raw transaction payload expected by Agent
Wallet. The MetaMask adapter rejects multiple calls instead of silently losing
batch or atomic semantics. The command still refreshes authoritative staged EVM
calls, validates one sender and chain, and never signs, broadcasts, injects the
execution-time service fee, or reports backend completion. The full 1,574-test
repository suite, repository lint, root typecheck, client build, CLI help, and
npm package dry run pass. MegaETH MOSS CLI v0.1.6 accepts the exported call
shape through normalization and reaches wallet-profile loading; live MOSS or
MetaMask submission still requires the user's external wallet authentication
and approvals.

## Chain logo refresh

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-21** — add
official monochrome MegaETH and Arc Testnet SVG marks to the shared chain icon
registry and ship the generated widget artifacts. The widget-lib package is
patch-bumped to `@aomi-labs/widget-lib@2.0.4`; its 353-test registry suite,
client registry-artifact test, package build, and repository lint pass.

## Canonical CLI wallet/user-state contract

Current session goal: **IMPLEMENTED AND STAGING VERIFIED 2026-08-22** — the
working-tree-only CLI wallet cleanup is reconciled against current frontend and
backend `origin/main`. The persisted SVM cluster invariant now also covers a
one-shot key added to an existing session; React sends exactly the backend
`ProviderState`, is patch-bumped to `0.6.3`, and has rebuilt publish artifacts;
stale documentation references are gone. A real built CLI against staging
backend main `2fae659e` persisted and round-tripped an isolated SVM devnet
wallet under the canonical `svm` key, with no legacy `solana` key. No publish is part of this session; the change ships via PR.

## Build staging candidate-release secrets

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-19** —
reconcile the Build deployment write-gate with the project Environment/Home
read model. A candidate release's authoritative 409 missing-secret response is
now retained (key names only) across a tab refresh, merged with the Manager's
persisted declarations, and cleared as soon as the matching Environment value
is saved. Deployment and promotion failures now surface the same actionable
required-secret state instead of falling back to “No keys required”.

## MCP to CLI partial-execution recovery

Current session goal: **IMPLEMENTED AND LIVE-CHAIN VERIFIED 2026-08-19** — make
sequential external signing outcome-aware when a requested action confirms but
an appended service-fee transfer fails. The CLI journals confirmed staged IDs
before backend callbacks, reports fee outcomes separately with exact wei,
replays callbacks without rebroadcasting, and preserves the MCP/OAuth boundary:
only the local CLI signs and broadcasts. The published package tuple is
`@aomi-labs/client@0.5.1`, `@aomi-labs/react@0.6.2`, and
`@aomi-labs/widget-lib@2.0.3`, so React/widget consumers resolve the updated
wallet executor as well as direct CLI users. A fresh staging MCP request completed after action hash
`0xcefe1911f4986b941be5e6e6c5b9bef7495af4d2b51ad661204172561c3c8ef2`
confirmed and its delegated-account fee leg failed; the retry did not increase
the wallet nonce or rebroadcast the action.

## Generic Solana wallet restoration

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-17** —
keep Wallet Standard Solana adapters available in the shared wallet kit
regardless of whether Para or Privy supplies embedded wallets.

- Para and Privy now compose their embedded Solana wallet state with the
  provider-level Wallet Standard state instead of replacing it.
- Solana options are deduplicated and routed to their owning provider, so a
  user can switch between generic and embedded wallets.
- Wallet Standard auto-connect is given one opportunity to begin before the
  runtime calls `connect`, preventing the Phantom double-connect failure.
- The publishable widget package is patch-bumped to
  `@aomi-labs/widget-lib@2.0.2`.
- Verified the 351-test registry suite, focused runtime regressions,
  regenerated the affected Landing registry mirrors, and passed
  registry/Portal/landing typechecks and builds, 27 TypeScript CLI Solana
  tests, 200 backend SVM tests, and a local Portal browser smoke with an
  injected Phantom Wallet Standard adapter.

## Backend-Owned Sponsored ERC-4337

Current session goal: **CI REPAIR LOCALLY VERIFIED; MERGE AND END-TO-END SMOKE IN
PROGRESS 2026-08-13**
— make the cross-origin widget an authentication and owner-signing client while
the backend owns smart-account provisioning, mandatory Aomi fee construction,
sponsorship, broadcast, confirmation, and revenue receipts.

- Replaced partner-controlled AA/paymaster configuration with the required
  `applicationId`, `apiUrl`, and authentication-only browser/Para/Privy
  contract.
- Added a single ordered `WalletOwnerSigner` boundary for browser EOAs and
  Para/Privy embedded EOAs; the widget receives only display-safe calls and
  signing messages, never Alchemy preparation blobs or credentials.
- Added explicit origin-bound operation signature/reject requests with
  `credentials: "omit"`, plus automatic backend provisioning after owner and
  chain resolution.
- Removed legacy `aa_handoff` rehydration and generic thread callbacks for AA;
  operation replay now resolves against backend state.
- Versioned the breaking publishable packages and proved the server-owned
  prepare/sign/send path with sponsored Base Sepolia transaction
  `0xb426a23e41ccba02a11fc2346992fd6fbd449e59f26d6a0c6d7c2c9ea4cb14bd`.
- Reconciled PR #469 with current `main`, including staged EVM chain selection;
  retained durable provider-registration, missing-provider,
  network-preference, signer/address, authorization, fee-path, and chain-switch
  regressions while deleting the obsolete legacy EIP-712 orchestrator test.
- Verified 1,476 root tests and 347 registry tests, root lint/typecheck, Portal
  typecheck, Telegram and widget-consumer production builds, and all changed
  publishable package builds.
- After backend PR #947 merged, isolated the Portal proxy regression from local
  signing-key configuration by mocking the proxy's actual bearer dependency.
  Migrated all three landing Solana runtime drivers from the deleted
  `solana_sign` arm to the generic `signing` envelope through one shared,
  type-safe request builder, and supplied the runtime's dismiss contract.
- Re-verified all five app typechecks and production builds, package
  typecheck/builds, 1,477 root tests, 396 Portal tests, and 6 Telegram tests
  with `PORTAL_SERVICE_PRIVATE_KEY` explicitly absent. The remaining workflow,
  frontend merge, and local backend-driven AA smoke are in progress.

## MCP explicit chain context

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-13** —
remove fabricated Ethereum and Solana mainnet state from headless MCP chat.
`aomi_chat` accepts an optional explicit EVM chain or supported Solana cluster;
omission retains account wallet identity without claiming an active network.

## Cross-chain wallet approval review

Current session goal: **IMPLEMENTED AND REVIEW CLEANUP COMPLETE 2026-08-13** —
switch staged EVM transactions before simulation and signing without issuing a
second switch request from the lower executor. The handler now passes an explicit
already-selected chain into native execution, direct executor callers retain their
own switch behavior, the stale implementation plan was removed, the checked-in
registry mirror was regenerated, and publishable versions are
`@aomi-labs/client@0.4.7` and `@aomi-labs/widget-lib@1.4.30`.

## Agentic Payments Execution-Harness Research

Current session goal: **REWRITTEN AS A RESEARCH PAPER AND LOCALLY VERIFIED
2026-08-13** — publish a
source-backed Aomi Research report that defines the emerging execution-harness
category for agentic payments, separates it from models, wallets, payment
protocols, funding, and settlement, and states Aomi's position as an onchain
agent execution runtime. The report must preserve canonical Aomi branding,
make its same-model harness thesis falsifiable, and pass local build plus live
production verification.

## Safari wallet-state sync containment

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED; STAGING ROLLOUT IN
PROGRESS 2026-08-10** — keep a
best-effort wallet-state notification failure from becoming an unhandled
promise rejection when an anonymous user changes networks. The regression was
reproduced in WebKit by selecting Arc Testnet and receiving an expected 401
from `/api/system`; the React package is patch-bumped to
`@aomi-labs/react@0.5.13`.

## Arc Testnet staging support

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED; STAGING ROLLOUT IN
PROGRESS 2026-08-10** — add Arc Testnet (`5042002`) across the shared chain
catalog, wallet providers, server-side SIWE verification, and Portal network
selection. Disconnected read-only chat retains the selected chain instead of
falling back to Ethereum. Arc is represented as USDC-native with 6 display
decimals while backend RPC accounting retains 18-decimal native precision.
Publishable packages are patch-bumped to `@aomi-labs/account@0.1.12`,
`@aomi-labs/client@0.6.3`, `@aomi-labs/react@0.5.12`, and
`@aomi-labs/widget-lib@1.4.27`.

The official package catalog now accepts exact chain IDs from release
metadata. Circle StableFX is decorated as an Arc-only package, remains visible
on other networks, and cannot be installed until Arc Testnet is selected. An
unknown or disconnected wallet chain fails closed for chain-scoped installs.

## Browser Response Latency

Current session goal: **SIMPLIFIED AND LOCALLY VERIFIED 2026-08-10** — improve
browser chat responsiveness without adding a backend streaming protocol.

- Empty drafts prewarm through one shared create/control promise; send awaits
  the same work and retries a failed speculative warm.
- A model change during prewarm gets at most one follow-up control sync.
- State polling uses one timeout and one in-flight request, slows in hidden
  tabs, reconciles when the tab becomes visible, and backs off after failures.
- Completed text renders immediately instead of replaying a synthetic 500 ms
  typewriter animation.
- Thread state/SSE reads remain bearer-independent at the Portal proxy, while
  the existing origin-bound widget-session check still gates cross-origin
  requests and spoofed browser authorization/cookies are stripped.
- No turn ID or `assistant_text_started` client protocol is included; the
  frontend continues to work with the existing backend and polling contract.
- Publishable versions are `@aomi-labs/client@0.4.4`,
  `@aomi-labs/react@0.5.11`, and `@aomi-labs/widget-lib@1.4.26`.
- All 1,467 root tests plus the configured registry trace suite, repository
  lint, client typecheck, and all three publishable package builds pass.

## Canonical Build Projects Refactor

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED
2026-08-03** — replace the frontend's invented source/discovery model with the
backend's canonical platform-bound Project model, with no compatibility path.

- Removed `/sources`, `app_source_id`, `AppSource`/`UserSource`, frontend
  `.aomi/config.json` parsing, and manifest-path forwarding.
- Project pages now consume only persisted builder-owned projects; GitHub App
  repository access remains candidate data used only during explicit creation.
- Deployment history uses the account-wide project feed and `projectId`.
- Operate reads are account-wide by default; selected-project detail uses the
  project's bound platform, and Telegram receives eligible applications across
  every bound platform.
- Preflight resolves and returns an immutable commit; apply requires it.
- The breaking shared packages are versioned as `@aomi-labs/deploy@0.7.0` and
  `@aomi-labs/client@0.4.0`.
- Project and Application identities are now separate in every touched path:
  Project owns deployment/provider administration, while environment,
  observability, chat, and deactivation target canonical numeric Application
  ids. The new service contract uses Builder vocabulary
  (`getBuilderApplication` and `/builder/applications/:id`) rather than
  account-user terminology.
- Environment loading keeps the editor and declared variables mounted while
  vault handles resolve, eliminating the tab's empty-panel flicker.
- Local manager + Build browser E2E against an isolated migrated Postgres
  database verified that candidate repositories never appear as projects,
  deployment history spans platforms, World Markets opens from observability
  overview into detail, and the Telegram picker offers World Markets even from
  a Community shell URL.
- The published TypeScript CLI now sends deploys to the V2
  `/api/projects/:projectId/deploy` route, omits client-selected platform data,
  and persists the platform resolved by the backend response.

## Deployment Lifecycle Cleanup

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-07** — make
deployment completion mean that the selected release is actually active and
loaded in the project runtime, while removing the stale name-scoped readiness
path and keeping app/release identities paired end to end.

- Added one shared, cancellable deployment/runtime polling contract used by
  Build and Portal onboarding plus project redeploy flows. Permanent 4xx
  failures stop immediately; transient failures retain their final diagnostic.
- Replaced the ambiguous per-app `/launch/app` route and browser method with a
  project-owned batch runtime snapshot, with no compatibility route.
- Centralized deployment target extraction, progress mapping, and browser
  fatal-error classification in `@aomi-labs/deploy`, deleting the duplicated
  Build/Portal implementations and preventing independently filtered app and
  release-tag arrays from drifting.
- Routed both dashboards' GitHub session, sign-out, and launch-project reads
  through that same browser client and removed their unused launch URL maps;
  Build retains its intentional local wizard reset after sign-out.
- Review follow-up named the CI and runtime deadlines independently, made
  transient runtime failures advance watcher progress while preserving the
  last snapshot, simplified stale-project error guards, and added route-level
  coverage for malformed deployment manifests producing no activation targets.
- Versioned the changed publishable contract as `@aomi-labs/deploy@0.7.0` and
  verified its build and focused tests, full Build/Portal tests and lint, Build
  type-check, and Portal type-check through the known unrelated missing Para
  connector dependency.

## Telegram Para Mini App

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-06** — use one
Para Mini App page for verified Telegram login and canonical wallet requests,
with Portal issuing the account bearer only after Telegram session ownership
and Para identity verification agree. The Mini App no longer owns a Telegram
relay or legacy operation pages; transaction and EIP-712 acknowledgements flow
through the canonical Session contract.

- Added the shared Telegram Ed25519 launch verifier to `@aomi-labs/account` and
  a Portal exchange route that safely claims an unowned/same-owner thread,
  links Para to that canonical user, and issues an origin-bound widget session.
- Kept the public BotFather contract aligned to `/start`, `/thread`,
  `/wallet`, `/permission`, `/tx`, `/app`, `/model`, `/network`, and
  `/disconnect`.

## MCP Chat Parity

Current session goal: **UNIFIED AUTH IMPLEMENTED AND LOCALLY VERIFIED
2026-08-24** — the Agent and Pipeline MCP surfaces now use one Better Auth 1.7
issuer at the canonical versioned `/v1/agent/mcp` and `/v1/pipeline/mcp` resources.
The former `/api/mcp` and `/api/mcp/direct` paths are absent. The same issuer,
WalletKit-capable login/consent UI, exact resource policy, anonymous identity,
refresh/revocation, and device authorization also serve developer and guest
REST under `/v1/agent/*` and `/v1/pipeline/*`. Public tokens stop at the portal;
only downscoped internal Aomi bearers cross the Rust trust boundary.

The earlier live-chain parity evidence remains relevant to the frozen MCP tool
schemas and Gate F business behavior. The 2026-08-24 cutover adds focused local
auth, scope, DPoP, CSRF, guest-linking, SDK, migration, and backend enforcement
coverage; shared-environment deployment and real-client canary checks remain
explicitly outside this implementation session.
The funded-wallet follow-up attached the local OAuth server to a fresh Codex
process, made progress cursors self-contained after that client exposed a
missing-session retry loop, imported the account-owned MCP thread into the CLI,
and signed its one-wei Base self-transfer. Both the requested transaction and
service-fee transaction confirmed, and a later MCP check returned an empty
pending queue plus both hashes.

## Chat Composer Parity

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-05** — keep the active-thread
composer the same resting size as the welcome composer and place it closer to
the bottom of the Portal viewport. Both states now share the same component
padding and horizontal inset; Portal no longer adds chat-only input height or
bottom-spacing overrides.

## Orchestrator Working-Trace Scrolling

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-05** — keep
the capped working-trace viewport pinned to new nested subagent steps while the
reader is following the latest activity. Child-step growth now also refreshes
overflow affordances; manually scrolling up still opts out of auto-follow.
Completed agent rows no longer render serialized structured `thread_return`
objects as prose: they extract explicit summary fields or fall back to a compact
staged-count status, including objects clipped by the completion-event wire
budget into invalid JSON. The compact row prefers a readable, width-truncated
preview of the child result, and the expanded child rail ends with the full
humanized return message. `Staged N` with the trace's staging Layers glyph is
reserved for runs with no recoverable return. The trace status consistently says `Working`/`Worked…`;
the blue Orchestrator badge alone identifies orchestration mode.

## App Selector Semantics

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-05** — make
the Portal app selector distinguish Basic, Orchestrator, and individual apps
accurately. The default is now labeled `Basic` and described as running
without a selected app; Orchestrator is described as coordinating work across
any number of apps and keeps its bot icon in the compact selected state.
Focused selector/metadata tests and the publishable widget build pass, with
`@aomi-labs/widget-lib` patch-bumped to `1.4.23` and registry mirrors refreshed.
The reported short local catalog was separately traced to GitHub API rate
limits during per-application artifact reconciliation; production and staging
still expose the full catalog.

## Chat Model Default

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-05** — make
GPT-5.6 Terra the default user-facing chat model across the backend and React
frontend. The product-mono runtime now defaults its chat rig to Terra while
retaining Luna for the separate internal BAML helper workload. React auto mode
prefers Terra ahead of its previous Haiku fallback, with focused resolver and
control-context coverage. Rebuilt the publishable React artifacts and
patch-bumped `@aomi-labs/react` to `0.5.8`.

## BFF Sentry Observability

Current session goal: **LOCAL IMPLEMENTATION AND REVIEW FIXES COMPLETE;
EXTERNAL ROLLOUT PENDING 2026-07-30** — the approved server-only Sentry observability design in
`docs/topics/bff/facts/sentry-observability.md` is implemented and locally
verified for both Portal and Aomi Build, including the shared
three-layer identify/classify/route pipeline, typed Account/Deploy observers,
behavior-preserving ownership boundaries, controlled staging smoke routes, and
automated verification. The review follow-up made the pipeline and async
observer seams non-throwing, restored existing HTTP/JSON-RPC/silent-degrade
contracts, added a safe production fallback when Sentry is unavailable, and
removed all Smither/schema changes. The final review restored the two-read
Build resume fallback, aligned artifact-degrade telemetry with its 404/409
responses, and closed the remaining GitHub/supervisor response-contract
drift. External Sentry/Vercel/dashboard
configuration and live staging smoke verification remain unperformed and
require separate authorization.

## Aomi Build Control Plane Performance

- Replaced the deployments page's per-source history fan-out with one
  keyset-paginated manager projection feed.
- Added a shell-level TanStack Query cache so Projects and Deployments retain
  data across tab remounts instead of loading from scratch.
- Scoped project and deployment cache keys by GitHub login and clear the cache
  on sign-out to prevent one account from reusing another account's data.
- Projects remain fresh for 60 seconds, deployment history for 15 seconds, SDK
  status for 5 minutes, and inactive entries remain cached for 15 minutes.
- Kept backend endpoint contracts unchanged; the new global feed belongs to
  manager and the Aomi Build BFF relays it.

## Control Plane Request Usability

Current session goal: **IMPLEMENTED AND LOCALLY VERIFIED 2026-08-03** — keep
authenticated Build and Portal pages functional under normal navigation and
deployment polling without hiding real failures behind indiscriminate retries.

- Removed the process-local, per-IP request budget from authenticated Build
  and Portal launch/deployment routes while preserving write-origin checks and
  the targeted limiter on expensive unauthenticated widget-auth endpoints.
- Limited foreground control-plane recovery to one network or gateway retry;
  deterministic HTTP failures surface immediately, and a 429 retries only when
  the server supplies a short `Retry-After` delay. Intent prefetches never retry.
- Replaced per-app activation verification fan-out with one source snapshot per
  polling interval, and made the Create build-run poll sequential, hidden-tab
  aware, and cancellable on navigation/unmount.

Current session goal: **IMPLEMENTED; LIVE E2E IN PROGRESS 2026-07-22** — implement and verify
`specs/WIDGET-AUTH-INTEGRATION-PLAN.md` across `aomi`, `db-master`, and
`product-mono`, including tenant-scoped provider identities, the atomic
canonical-user resolver, origin-bound widget sessions, generic Portal/account
routes, the published `AomiWidget` API, and the separate-origin consumer.

2026-07-13 follow-up: staging and production now use separate Supabase
databases. Local schema convergence applies the backend's forward drop instead
of recreating the retired `bff_cli_device_sessions` / `bff_cli_sessions`
tables; fresh databases also finish replay with that drop.

2026-07-26 follow-up: the hosted topology is explicitly limited to staging
`cmwkmjpfbffmdiluvgtu` and production `akejwtxsjvbexutsfhkn`; the public
architecture guide now names both refs so a legacy third target cannot be
mistaken for another supported environment.

Progress:

- 2026-08-10 Build staging import hand-off: kept the Connect control disabled
  after navigation starts (instead of briefly re-enabling it before GitHub
  loads), while retaining retry after a failed hand-off. The manager now
  rejects duplicate repository imports atomically, and platform branch commits
  rebase their tree update and retry a concurrent fast-forward race up to three
  times.

- 2026-08-05 MegaETH chain support: completed chain 4326 coverage in React
  network naming, server-side smart-account SIWE verification, and the Landing,
  Docs, wallet-kit, and Privy default network registries. Publishable packages
  were patch-bumped and generated artifacts rebuilt.

- 2026-08-02 PR #436 integration: merged account-level Operate observability
  and payment reads into the platform-switch branch, including the concurrent
  deployment-read ownership cache. Preserved the intervening system-notification
  work from current `main`, patch-bumped `@aomi-labs/deploy` to `0.4.1`, and
  verified the focused Operate, launch, and deploy-client tests, Build
  type-check, and deploy package build.

- 2026-08-01 Aomi Build exact platform switching: added a non-discoverable
  header input that checks an exact platform name against the authenticated
  manager source read, keeps the current page unchanged on a missing platform,
  and opens the matching platform-scoped Projects page on success. Partner
  names are not hardcoded or listed in the frontend; `APP_DEPLOY_PLATFORMS`
  continues to supply the default launch platform rather than the set of names
  a signed-in user may try.
- 2026-08-03 (later) canonical sign-out centralized: extracted the
  signOut-then-disconnect sequence into widget-lib
  (`wallet-kit/account/sign-out.ts`), made it DualWalletBar's disconnect
  default (the old fallback skipped account/widget session teardown), pointed
  WalletPicker at it, and dropped portal's now-redundant `onDisconnect`; also
  contained disconnect failures (no unhandled rejection, dialog stays open for
  retry) and stopped the confirm-dialog backdrop from dismissing mid-flight.

- 2026-08-03 Portal account-menu session safety: made sidebar Disconnect end
  the canonical Aomi account/widget session before dropping wallet-provider
  connections, corrected the history copy to describe account-backed history,
  and added focused coverage for provider-settle timing, transient and terminal
  account probes, retry, teardown ordering, and the shared confirmation flow.

- 2026-08-02 notification presentation preview: moved the shared notification
  toast to a macOS-style upper-right stack below the chat header, added Aomi
  title/body hierarchy and custom blue line-art notice, success, error, and
  wallet SVGs, and verified the live Portal layout in dark mode. Wallet
  transaction requests now use the wallet presentation instead of a generic
  notice. Internal `/api/system` acknowledgement records are filtered before
  they reach chat, persisted system transcript records stay hidden, and live
  wallet connection plus system notice/error events route through the
  notification model; payment-required messages retain the dedicated blocking
  gate. Non-blocking notification banners dismiss after six seconds by default
  and remain manually dismissible.

- 2026-07-31 Portal thread-history recovery: decoupled canonical account
  history from wallet connectivity, so a signed-in user can load and retain
  their threads with no wallet attached. Account identity changes remount the
  runtime to prevent one signed-in account from retaining another account's
  in-memory thread list.

- 2026-07-30 BFF Sentry review fixes: made identify/classify/route defensive
  end to end, normalized invalid response statuses and context, absorbed async
  observer rejections, reordered Build recovery before telemetry, and removed
  telemetry-only orchestration dependencies. Restored pre-existing Deploy,
  Account proxy/token, device/provider auth, MCP, GitHub cookie, and Build
  fallback contracts. Removed the Smither observer, result field, generated
  declaration changes, package bump, and database-shape impact entirely.

- 2026-07-29 integrations consolidation: moved the functional Telegram bot
  configuration from Operate into Integrations, retained Discord as an explicit
  coming-soon integration, and redirected the retired Bots route. Verified the
  focused bot UI regression, Build lint, and Build type-check.

- 2026-07-27 hosted account-pool hardening: traced recurring Settings auth
  failures to aggregate Supabase session exhaustion across two backend and two
  manager processes plus independently warm Vercel functions. Portal now
  normalizes a Supabase session-pooler URL to transaction mode on Vercel while
  retaining a one-client, short-idle local pool; paired backend deployment
  work splits and verifies the fleet-wide session budget.
- 2026-07-27 Build layout: standardized all twelve primary pages on responsive gutters and PT Serif titles paired with their navigation icons.
- 2026-07-27 Build project membership: the Projects index now treats GitHub
  source records as internal import/ownership metadata and only surfaces
  sources that contain at least one Aomi app, removing historical repositories
  that were bound to a platform but never became Build projects.
- 2026-07-27 cross-platform project discovery: the Projects index now uses the
  backend's platform-agnostic, GitHub-user-scoped source list instead of
  silently defaulting to `community`, and project links preserve each source's
  bound platform for detail reads.

- 2026-07-27 deployment-history correctness: the project History view now
  loads the deployment-history API and merges it with the promotion log, so a
  successfully deployed/live app remains visible even when its append-only
  promotion records are empty. Promotions continue to use the activation log.

- 2026-07-27 Shared chat welcome title: replaced the Portal and Landing
  one-off catchphrases with the shared “What should happen on-chain?” default
  and styled it with the same regular PT Serif display face used by Aomi Build
  page titles.

- 2026-07-27 Aomi Build CLI auth completion: replaced the localhost callback's
  raw inline HTML with a redirect to a branded Build completion page based on
  the existing Portal device-auth surface. The hosted page receives only a
  coarse completion status; OAuth codes and state remain confined to the
  loopback callback and CLI exchange.
- 2026-07-27 Build deploy-platform configuration: reduced the BFF deploy
  default configuration to one server-only source, `APP_DEPLOY_PLATFORMS`, and
  removed the singular and `NEXT_PUBLIC_*` compatibility paths so Vercel
  configuration cannot silently diverge. The 2026-08-01 exact-match switcher
  subsequently moved partner-name validation to the manager lookup rather than
  treating this default configuration as a partner directory.

- 2026-07-27 Para ACL mode recovery: confirmed the reported staging Para EVM
  row is user-controlled (`provider_managed = false`) and that the backend
  permits `client_auto` without a delegated grant. Removed the frontend's
  incorrect self-custody-only gate so Para can select “Accept transactions”;
  `Auto` still correctly requires a live delegation grant and `Locked` remains
  available. Added a regression covering all three availability states and the
  complete challenge, Para signature, commit, and refresh path.

- 2026-07-26 usage-log model-key attribution: normalized the manager's safe
  model-key metadata into the deploy client and rendered a compact key
  label/prefix badge beside funded usage events in Aomi Build Logs. Added
  client and UI regressions, patch-bumped `@aomi-labs/deploy` to `0.2.4`, and
  verified focused tests, package build/pack, Build lint/typecheck, and the
  production Build compile. Refreshed the staging backend route contract after
  three account endpoints shipped and removed the unreliable external
  coordination workflow from frontend CI.

- 2026-07-26 staging Portal account-auth recovery: traced the Settings
  `widget_auth_failed` response to Vercel Preview using the production Supabase
  session pool, where parallel BetterAuth/account functions exhausted the
  15-client cap. Restored global Preview to the canonical staging branch using
  its transaction-pool URL, rebuilt merged `main`, and confirmed concurrent
  session/account probes with no 5xx or pool-exhaustion logs. Settings now
  translates widget-auth and unknown structured transport failures into calm,
  actionable copy instead of rendering raw JSON.
- 2026-07-27 TypeScript cleanup and release validation: decomposed the Portal
  Packages overlay into its catalog data, catalog-loading hook, package row,
  and modal orchestration so every logic file remains under 500 lines without
  changing the UI or API boundary. Split the 740-line dev theme audit into a
  specimen surface and contrast table, removed avoidable assertions, and kept
  its measured token behavior intact. Verified focused lint/typecheck/tests,
  all repository CI commands, full Portal tests, and production builds for
  Portal, Landing, and Aomi Build; the Portal build used mock-safe local auth
  and database values only.

- 2026-07-27 Light/dark design-token sweep: fixed a dark-mode collision where
  `--aomi-surface-2`, `--aomi-raised` and `--aomi-border` all resolved to
  `#27272a`, rendering every divider, table rule, meter track and icon-button
  fill at 1.00:1 — the same collision existed independently in `apps/build`.
  Re-laid both dark ramps as six distinct steps, split `--aomi-success` per
  theme, un-collided light's `--aomi-hover` from `--aomi-surface-2`, removed a
  duplicate `--aomi-ring` that was overriding the sky focus ring with grey, and
  made `.dark` re-declare its derived `color-mix()` tokens (they only worked
  because `.dark` sits on `<html>`) while adding a `.light` scope so either
  theme can be applied to a subtree. Added a dev-only `/dev/theme-audit` harness
  that renders every redesigned surface in both themes from static fixtures and
  measures 21 contrast pairs: 9 hard failures down to 4, all light-mode and
  intentional. Left as design calls: the light accent is 3.71:1 as text (AA
  needs 4.5), and `--aomi-warning` is an unreferenced dead token.

- 2026-07-27 Build title typography and Packages spacing: loaded the same PT
  Serif display face used by Portal's Usage Statement into Aomi Build and
  applied the shared display treatment to all 15 Build page-level headings,
  including Deployments, Transactions, and Observability. Increased the Portal
  Packages title-to-search gap to 25px while preserving the divider rhythm
  below the search field. Verified Build lint/typecheck, all 15 heading
  contracts, live computed PT Serif rendering on `/build`, the 7 focused
  Packages tests, Portal lint/typecheck, and live Packages geometry.

- 2026-07-26 Landing and Portal UI polish: scoped the Landing demo layout
  independently from Portal, default-collapsed its sidebar, refined the welcome
  spacing and composer layout, added a slow edge-faded suggestion marquee,
  improved dark-mode segmented-control contrast, and prevented horizontal
  scrolling in both welcome and docked composer inputs. Aligned the Portal
  Packages overlay to the Settings reference frame, header, typography, and
  close control, and replaced raw proxy HTML failures with a bounded package
  error. Patch-bumped `@aomi-labs/widget-lib` to 1.4.14, refreshed the affected
  Landing registry mirrors, and verified the registry build and 277 tests,
  Landing lint, focused Portal package tests, Portal lint/typecheck, and live
  equal overlay geometry.
- 2026-07-24 idempotent npm publishing: changed the post-merge publish job to
  skip exact package versions that are already live, publish only missing
  versions, and fail closed on registry errors other than a definitive 404.
  This makes reruns safe after partial publication or transient npm outages.

- 2026-07-24 atomic account ownership: split provider sign-in from authenticated
  linking and preflight every verified provider, email, BetterAuth, EVM, and
  Solana signal under one transaction before creating or attaching canonical
  ownership. Conflicts now produce no canonical writes or session, surface a
  non-identifying recovery message, and last-factor unlink checks serialize per
  account. Added sign-in, linking, conflict, retry, and unlink regressions and
  patch-bumped `@aomi-labs/account` to 0.1.8 and `@aomi-labs/widget-lib` to
  1.4.12.

- 2026-07-22 model catalog availability: traced the staging picker's permanent
  `Loading...` state to Better Auth session-pool exhaustion on the otherwise
  public `/api/thread/models` proxy route. Marked that catalog route as
  bearer-independent so it bypasses account database resolution while still
  stripping browser credentials, added proxy regression coverage, and
  patch-bumped `@aomi-labs/account` to 0.1.6.

- 2026-07-23 review-blocker closure: default wallet-mode widgets now withhold
  their required AccountBearer source until an EVM/SVM signer is actually
  available; superseded widget-session exchanges after sign-out or a wallet
  switch revoke their late WST and reject the waiting request instead of
  returning a stale principal; and account refreshes are keyed to the active
  auth/client context so an old provider response cannot overwrite a newly
  selected user's state. Added focused regressions for all three paths,
  removed the stale test-only adapter `kind` fields, rebuilt client/widget
  artifacts, and refreshed the Landing registry mirror. Verified 816 root
  tests, 278 widget tests, lint, root/account/Portal typechecks, client and
  widget builds, and the widget-consumer production build.

- 2026-07-23 widget-auth PR main sync: rebased frontend PR #382 and backend PR
  #855 onto current `main`, preserving the newer x402 and Solana approval work
  alongside tenant-scoped widget authentication. Reconciled the Portal x402
  signer address type, regenerated client/React/widget registry artifacts and
  the Landing registry mirror, and patch-bumped `@aomi-labs/account` to 0.1.7
  and `@aomi-labs/client` to 0.3.9 after the versions already on `main`.
  Verified frozen install, lint, root/account/Portal typechecks, 782 root tests,
  269 widget tests, the Portal test command and production build, the client,
  React, and widget builds, and the widget-consumer production build. Backend
  fmt, database clippy with warnings denied, and the focused plain-message
  signing pipeline test also passed before its rebased branch was pushed. The
  first clean frontend CI run exposed generated-state assumptions that local
  builds had masked: registry boundary tests ran before the package build, and
  Landing could not resolve a widget source import through its narrower
  `@/lib` alias. CI now builds the registry before its tests, the shared import
  is package-relative, and the exact registry-build/test plus Landing production
  build sequence passes locally.
- 2026-07-23 fleet-safe Telegram bot mappings: Build now creates and edits
  builder-wide many-to-many bot/app mappings with a required primary app,
  source-qualified display labels, and write-only credentials. The BFF validates
  every selected app against the signed-in builder's sources before calling the
  manager-wide bot API.

- 2026-07-22 wallet account-access deduplication: hid the legacy `wallet`
  authentication identity from account management, matching the existing
  SIWE/SIWS proof-identity behavior while preserving the branded linked EVM or
  Solana wallet row. Added the reported Rabby regression case and patch-bumped
  `@aomi-labs/widget-lib` to 1.4.10.

- 2026-07-22 Vercel Preview account-state recovery: reproduced the missing
  account badge and connected-only Phantom row while chat history remained
  visible, then traced the repeated 500s to Supabase session-pool exhaustion
  (`EMAXCONNSESSION`, 15-client cap) across separate Vercel API functions. The
  account package now limits Vercel instances to one short-lived Postgres
  client instead of four 30-second clients, with regression coverage and a
  patch bump to 0.1.4. The non-fatal session warning remains diagnostic: it
  compares a queued pending transaction snapshot with the later terminal
  simulation state and does not indicate a signing or broadcast failure.

- 2026-07-22 Vercel PR-preview auth recovery: found that the repaired staging
  `DATABASE_URL` was still scoped only to `Preview (main)`, so ordinary PR
  previews inherited the stale global Preview database and returned 401/403 at
  the backend account boundary. Promoted the already-verified encrypted staging
  value to global Preview scope without exposing the credential, redeployed PR
  #381, and passed disposable SIWS, canonical account, AccountBearer, wallet,
  thread list/create, cleanup, and session-revocation checks with HTTP 200. The
  replacement deployment recorded no 401 or 500 responses during verification;
  Production was not changed.

- 2026-07-22 Solana Phantom approval recovery: reproduced the reported
  10,000-lamport mainnet self-transfer in signed-in Chrome and traced the
  missing popup to the frontend rejecting the backend's legacy
  `mainnet-beta` cluster label before invoking Phantom. Canonicalized legacy
  Solana cluster aliases at the client request boundary and defensively in the
  runtime handler, added send-request regression coverage, patch-bumped
  `@aomi-labs/client` to 0.3.7 and `@aomi-labs/widget-lib` to 1.4.9, and
  regenerated their publishable artifacts. The CLI decoded the supplied
  unsigned transaction as the expected self-transfer, its real Solana signing
  round-trip tests passed, and focused client/widget tests, targeted ESLint,
  portal typecheck, and the portal test command passed.

- 2026-07-21 portal x402 E2E: moved Coinbase x402 signing from the portal's
  Wagmi-only client to the shared wallet-kit adapter, so Para, Privy, injected,
  and other connected EVM wallets use the same `signTypedData`/chain-switch
  boundary. Verified the flow with a real MetaMask provider: SIWE created the
  canonical account, x402 switched the wallet from Base to Base Sepolia,
  MetaMask signed the USDC authorization, and the paid retry returned the
  rendered portal response. Removed the temporary local EVM signing harness
  after this proof.

- 2026-07-21 x402 BFF bridge: allowed the Coinbase x402 v2
  `Payment-Signature` request proof through the shared account proxy and
  returned `Payment-Required` challenges plus `Payment-Response` settlement
  receipts without broadening browser credential forwarding. Added coverage
  for chained partner/platform headers, patch-bumped `@aomi-labs/account` to
  0.1.5 and `@aomi-labs/client` to 0.3.8 after syncing current `main`, and
  verified the focused tests, account/portal/base/landing typechecks,
  formatting, and packed package contents.

- 2026-07-23 provider address-label polish: provider-managed Para and Privy
  rows under Account access now show only their shortened addresses in family
  order, separated by a middle dot (for example,
  `0xda6..f0 · 53GfE..oL`), without repeating `EVM` and `SVM` labels in the
  subtitle. Connected SVM rows now include `Solana` after the address, matching
  the network-name position already used by Ethereum and EVM L2 rows.

- 2026-07-23 thread-auth recovery: traced Portal and widget-consumer 401s to
  the live Rust backend using the remote database while BetterAuth/account
  resolution used `aomi_local`. Restarted the supported auth stack so both
  share the local database; AccountBearer and origin-bound widget-session
  probes now both list 43 threads with HTTP 200. The React runtime also keeps
  the caller's `localhost` backend host instead of rewriting it to
  `127.0.0.1`, and provider widgets withhold their required bearer source until
  the provider credential is ready.

- 2026-07-23 widget-consumer Solana diagnosis: confirmed from Para's live BETA
  partner metadata that Portal requires EVM + Solana wallets while the
  consumer/Landing Para project supports EVM only. The canonical Aomi account
  is shared correctly; only the provider project's live signer set differs.
  The Para developer dashboard is open at sign-in so Solana can be enabled for
  the consumer project before a logout/relogin provisioning check.

- 2026-07-22 provider account-access polish: merged tenant-scoped Para and
  Privy identities into one provider card, attached the provider-owned EVM and
  Solana addresses to that card, and distinguished live/write access (green)
  from linked/read-only access (yellow). The Portal now renders one Para row
  with both live families, while a consumer session that exposes only EVM still
  shows its linked Solana address as stored access. Grouped rename and unlink
  operations update every backing provider identity. Patch-bumped
  `@aomi-labs/widget-lib` to 1.4.10, refreshed the registry artifact, visually
  verified the live Portal modal, and passed all 267 registry tests, root lint,
  the registry build, Portal typecheck, and the widget-consumer production
  build.

- 2026-07-22 widget authentication integration: implemented the v1 code and
  automated acceptance coverage in `specs/WIDGET-AUTH-INTEGRATION-PLAN.md`. Added the
  audited tenant-scope migration and Rust schema/entity mirror; provider-neutral
  identity resolution; strict Para and disabled Privy widget descriptors;
  provider/SIWE/SIWS WST exchange with hashed storage, origin binding,
  revocation, and public credentialless CORS; generic account/BFF principals;
  and the published `AomiWidget`, `paraAuth`, `privyAuth`, and standalone Vite
  consumer. Portal retains its existing Para project while Landing and the
  consumer use the requested separate Beta key in ignored local env files.
  Portal is live on port 3000 and the consumer on port 3001. The consumer now
  renders the full widget plus an actionable Retry/origin banner when Para
  startup fails. The Landing project now accepts `http://localhost:3001` and
  the Google popup reaches Para's wallet-selection screen after restoring the
  SDK's OAuth encryption worker. The final live consumer
  login/thread/harmless-signing gate remains unchecked until the user completes
  the wallet selection and the post-login checks run.
  Patch-bumped account/client/widget-lib, refreshed artifacts and lockfile, and
  passed isolated Postgres replay, Rust fmt/clippy, frontend lint/typechecks,
  package/consumer builds and pack verification, 769 root tests, 252 registry
  tests, and the portal test command.

- 2026-07-20 Robinhood Chain support: added chain `4663` to the client and wallet-kit defaults, including Alchemy metadata, network selection coverage, a monochrome chain icon, generated registries, and explicit portal/landing/docs network lists. Patch-bumped `@aomi-labs/client` to `0.3.2` and `@aomi-labs/widget-lib` to `1.4.3`; focused tests, root/portal/landing typechecks, client and registry builds, lint, formatting, and the read-only client `chain list` CLI passed.

- 2026-07-19 Operate observability detail: replaced the #374 fixture route
  contract with owned source/application IDs and a live manager aggregate
  relayed through `@aomi-labs/deploy` and the Build BFF. Real detail, health,
  transaction, log, and deployment values stay authoritative; backend-missing
  chart/release slices retain explicitly labeled fixture fallbacks. Renamed the
  frontend workspace from `apps/aomi-build` to `apps/build`, patch-bumped the
  deploy package to 0.2.2, and moved the Vercel output directory with it. Full
  app tests, typecheck, lint, production build, package build/pack, GitHub CI,
  and the corrected Vercel preview passed. Staging E2E still depends on the
  backend release-build unblock in product-mono PR #841 reaching `main`.

- 2026-07-15 Aomi Build theming: replaced the app's hard-coded Cursor palette
  with the canonical light/dark tokens from `aomi-design`, added a persisted
  system-aware theme toggle without hydration flash, and aligned semantic
  colors, typography families, radii, shadows, and focus/scrollbar surfaces.
  Verified focused theme tests, Aomi Build lint/typecheck/production build,
  and live `/build` rendering plus reload persistence in both themes.

- 2026-07-20 wallet connection cancellation polish: the shared wallet picker
  now treats explicit provider rejection, WalletConnect reset/expiry, and
  EIP-1193 code 4001 as normal dismissal paths instead of rendering a red error
  banner. Genuine provider and relay failures remain visible. Added regression
  coverage, patch-bumped `@aomi-labs/widget-lib` to 1.4.7, and regenerated the
  registry artifacts.

- 2026-07-17 Solana full-balance swap and holdings polish: taught the Jupiter
  fast path to accept `amount: "all"` for SPL inputs so the backend resolves the
  connected wallet balance and transparently falls back from flaky mint-filter
  RPC reads to token-program scans. The standalone holdings tool now defaults
  its owner from SVM wallet context and returns compact aggregated display
  amounts. Added a dedicated holdings trace presenter that shows `0.148008
USDC` for the canonical mainnet mint, or just the visible UI amount with the
  generic token icon when the symbol is unknown. Patch-bumped
  `@aomi-labs/widget-lib` to 1.4.6 and regenerated registry artifacts.

- 2026-07-17 Solana working-trace polish: split SVM network context from the
  EVM interpreter so Solana traces show the chain family and current slot,
  and added a Jupiter preparation presenter that surfaces input amount,
  expected output, and token direction like the LI.FI swap trace while keeping
  raw tool data available in the expandable detail. Simplified the default
  mainnet picker row and compact trigger to `Solana`. Compact SVM network
  traces now show the formatted slot number without redundant text, and wallet
  approval traces include the staged SVM transaction count. SVM simulation and
  approval matching now live in a dedicated `svm-tx` family with routing tests
  that prevent Solana results from falling through to the EVM interpreter.

- 2026-07-17 browser Solana approval recovery: traced the missing Phantom
  prompt to the portal's zero-config mainnet RPC fallback. Solana's official
  public endpoint returns HTTP 403 to JSON-RPC requests carrying a localhost
  browser Origin, so the runtime failed while refreshing the blockhash before
  invoking the wallet. Switched the portal fallback to PublicNode's
  browser-compatible Solana endpoint, restarted the portal, and verified a
  localhost-origin `getLatestBlockhash` call, portal health, targeted ESLint,
  portal typecheck, and the portal test command.

- 2026-07-17 external Solana GUI parity: browser-connected SVM wallets now use
  BetterAuth SIWS for account creation and optional linking, matching the CLI
  and external EVM flow. Legacy backend binding remains limited to embedded
  wallets, and SIWS proof identities stay hidden from account management while
  the linked Solana wallet remains visible.

- 2026-07-17 wallet naming and thread archive follow-up: unlabeled BetterAuth
  SIWE wallet rows now inherit the connected EVM provider brand (for example,
  `Rabby 1`) without overwriting user labels. Restored durable archive and
  unarchive endpoints backed by `thread_archives`, exposed archive state in
  thread summaries, synchronized the client/OpenAPI contract, and verified the
  full live archive round trip plus canonical Rabby account response locally.

- 2026-07-17 BetterAuth Solana CLI parity: added SIWS nonce/verify endpoints to
  BetterAuth, synchronized verified external Solana wallets into canonical
  `public_keys`, and added Solana-only login plus authenticated wallet linking
  to the TypeScript CLI without the legacy backend bind ceremony. Live dev
  stack E2E covered Solana-only account creation and relogin, EVM-to-Solana
  linking, login through either wallet into the same canonical user, ownership
  conflict and last-factor protection, and an authenticated SVM commit followed
  by local Ed25519 signing and backend completion. Patch-bumped
  `@aomi-labs/account` to 0.1.1 and `@aomi-labs/client` to 0.3.3. GUI work is
  intentionally not started yet.

- 2026-07-16 Solana transaction parity: completed the shared HTTP client and
  CLI paths for SVM approval normalization, signing, broadcast, and terminal
  callbacks; added portal wallet binding and a loopback-only injected Solana
  signer for browser E2E; and made the default runtime preserve both EVM and
  SVM wallet/network state. Patch-bumped `@aomi-labs/client` to 0.3.2 and
  regenerated its publishable artifacts. Verified a Gemini 3 Flash transfer
  through the CLI and portal, including finalized on-chain signatures, backend
  pending-state cleanup, and interpreted Solana trace steps.

- 2026-07-16 staging thread-load diagnosis: reproduced `GET /api/threads`
  returning 401 and `GET /api/account` returning 403 for the connected wallet.
  Both statuses map to the backend's verified-bearer/missing-canonical-user
  paths, so the leading cause is Portal/backend staging database identity drift
  after the July 14 `DATABASE_URL` rotation, not thread rendering or wallet
  provider collisions. Direct Vercel/server environment comparison remains
  blocked by missing `chat-portal` team access and the unavailable staging VPN;
  a targeted backend-log request is prepared for the internal cloud agent.

- 2026-07-14 hosted SDK compatibility: Aomi Build now marks incompatible
  deployments as outdated, blocks their broken chat iframe, links users to the
  Deployments tab, and requests a source-owned SDK upgrade pull request before
  redeployment. Renamed the existing action to describe its actual linked-repo
  behavior and patch-bumped `@aomi-labs/deploy` to 0.2.1.

- 2026-07-14 UI interaction context: added active-thread
  `recordUiInteraction(payload)` over the existing `/api/system` transport,
  documented ordering before an immediate chat send, patch-bumped
  `@aomi-labs/react` to 0.5.2, and regenerated its publishable artifacts.
  Verified focused runtime tests, targeted ESLint, library and landing
  typechecks, the React package build, and the packed npm tarball.

- Removed runtime `/api/bff/auth/siwe/*`, `/api/bff/auth/exchange`, and
  `/api/bff/auth/token` mounts from portal, base, and landing.
- Added `/v1/account/bearer` for direct AccountBearer minting from an
  existing BetterAuth session.
- Inverted `@aomi-labs/account` so portal supplies the BetterAuth-backed
  canonical-user resolver.
- Moved CLI native SIWE to `/api/auth/siwe/{nonce,verify}` and BetterAuth
  bearer-session storage.
- Added auth regression coverage for preserving legacy wallet-keyed canonical
  UUIDs during first BetterAuth SIWE adoption.
- Verified typechecks for account, auth, client, portal, landing, and base;
  vitest suites for account/auth/client; portal test script; client build; and
  local CLI E2E against the dev auth stack.
- Follow-up live CLI E2E also verified no-browser SIWE account link and unlink:
  login with one wallet, link a second SIWE wallet, list links, logout/relogin,
  whoami, unlink the second wallet, and list links again.
- Local dev stack is running for manual testing at `http://127.0.0.1:3000`.
- 2026-07-03 review follow-up: drafted `specs/FINAL-REVIEW-CHECKLIST.md` with
  severity/complexity-ranked fix checklists and a security pass. New confirmed
  stop-ship items include MCP user spoofing, device-auth link credential
  exfiltration, the product-mono hosted DB credential, fail-open bearer proxy,
  base anonymous prod proxy, BYOK route drift, untracked db-master migrations,
  and the React control-context merge regression.
- 2026-07-03 AUTH-001 follow-up: rewired portal account-link storage away from
  durable `aomi_*` tables to the shared canonical `users` / `auth_providers` /
  `public_keys` graph. BetterAuth session tables remain session-only; SIWE and
  provider-attested wallets now land as canonical public keys with provider
  provenance. Verified auth/account package typechecks plus focused auth and
  account vitest suites. Live dev-stack E2E passed with CLI SIWE login, link,
  links, logout, relogin, whoami, unlink, final DB inspection, and the SIWE
  smoke path through portal-minted AccountBearer to backend.
- 2026-07-03 provider-link follow-up: tightened Para/Privy provider exchange so
  token-attested embedded wallets are synced with the provider identity, wallet
  ownership conflicts return 409 instead of creating an identity-only link, and
  the wallet modal no longer labels live provider wallets as linked until the
  canonical wallet row exists. Reset local `aomi_local`; backend/portal are
  healthy on 8080/3000 with empty auth/account tables.
- 2026-07-03 provider account-access polish: restored the GUI contract that
  Para/Privy Account Access shows the provider sign-in row only while the
  embedded EVM/SVM public keys remain durable backend graph rows. Provider
  wallet sync now merges REST attestations with verified token attestations so
  Para's JWT EVM/SVM wallets are not dropped when the REST response is partial.
- 2026-07-03 provider display follow-up: corrected wallet-picker semantics so
  durable Para/Privy account-wallet rows are not promoted into Connected unless
  the provider runtime reports live wallet rows, and Quick Sign-In dedupes
  method-keyed social rows against stored provider-auth rows by provider.
- 2026-07-03 final-review scope triage: updated
  `specs/FINAL-REVIEW-CHECKLIST.md` to prioritize current-branch blockers
  across `aomi`, `product-mono`, and `db-master`, and to defer pre-existing or
  non-branch findings such as `SEC-003` and `RUNTIME-004` unless owner scope is
  reopened.
- 2026-07-03 SEC-002 follow-up: moved device-auth provider link mode off raw
  credential loopback posts. CLI provider linking now creates an authenticated
  portal link intent, returns only a one-time PKCE code to an approved loopback
  `/callback`, and performs the provider link during portal exchange after the
  verifier check.
- 2026-07-04 SEC-002 verification: full root package Vitest suite, full portal
  Vitest suite, client build, actual CLI no-browser SIWE login/link/list smoke,
  and `scripts/smoke-auth-stack.mjs` with SIWE all passed against the local
  dev auth stack.
- 2026-07-03 SEC-004 follow-up: made the shared account proxy fail closed when
  a resolved BetterAuth session cannot mint an AccountBearer, added explicit
  optional-anonymous route policy for public widget routes, kept protected
  account/settings/secrets routes from forwarding without Authorization, and
  covered the behavior with focused proxy tests.
- 2026-07-04 SEC-004 verification: ran broad root/portal/telegram test suites,
  the live SIWE auth-stack smoke, and an actual CLI SIWE login/whoami/chat
  flow through the local portal proxy.
- 2026-07-03 SEC-005 base follow-up: replaced the Base app's hand-rolled
  anonymous catch-all proxy with the shared backend proxy, removed the
  production backend fallback for deployed environments, narrowed Base to a
  demo-only route allowlist, and updated Base env/docs/tests for the new
  explicit-backend requirement.
- 2026-07-04 SEC-005 verification follow-up: ran the broad root Vitest suite
  plus Base, shadcn registry, portal, and telegram app tests. CLI SIWE live E2E
  was not rerun because SEC-005 changes only the anonymous Base demo proxy and
  does not touch BetterAuth, SIWE, account linking, or CLI auth surfaces.
- 2026-07-04 RUNTIME-001/RUNTIME-002 follow-up: restored the React control
  context to the extracted hook composition from `origin/main`, reintroduced
  application/platform scoping through runtime, control, session, and client
  send paths, and covered platform filtering plus duplicate hosted app names by
  application id. Verified full React runtime/control Vitest coverage,
  targeted lint, client build, and library typecheck.
- 2026-07-04 XREPO-002/XREPO-003 prod-shape follow-up: created local
  `db-master` branch `codex/xrepo-db-migration-replay`, staged the 48
  previously untracked migrations, made
  `20260627005000_rename_sessions_to_threads.sql` self-converging for old
  `sessions` and already-renamed `threads` shapes, fixed the scheduled work
  cutover so prod `scheduled_intents` backfill into `threads.spawn_input` and
  `cron_jobs` before timer columns are dropped, and verified fresh replay plus
  prod-shaped seeded replay against an isolated local Postgres 17 container.
  Read-only prod inspection found deploy blockers: 12 duplicate provider-subject
  groups in `auth_identities` including 4 cross-user groups, and existing
  message duplicates that make the proposed `idx_messages_dedup` unique index
  invalid for prod. No GitHub push was performed; real staging/prod clone replay
  and duplicate-resolution policy remain deploy gates.
- 2026-07-04 portal settings route follow-up: migrated settings General,
  Usage, App Keys, Bots, BYOK, and Deploy install flows off stale
  `/api/settings/*` and `/api/control/provider-keys` paths onto the current
  `/api/account/*` backend contract, allowed the public GitHub App OAuth start
  route through the portal proxy, removed stale proxy allowlist entries, and
  made `/settings` accept a BetterAuth SIWE session cookie even when the wallet
  adapter is disconnected. Verified focused portal/client Vitest coverage,
  portal typecheck, client build, registry build, actual CLI no-browser SIWE
  login/whoami, and browser settings tab smoke with the CLI SIWE session.
- 2026-07-04 Vercel deploy-readiness follow-up: GitHub commit status showed
  only `Vercel - chat-portal` failing on `codex/merge-bff-betterauth` while
  `base`, `landing-page`, and `tg-mini-app` passed. Vercel CLI inspection was
  blocked by missing `aomi-labs` scope in the local CLI session, so remote logs
  could not be fetched. Hardened BetterAuth env resolution so Vercel preview
  deployments derive `baseURL`, SIWE domain, and trusted origins from arbitrary
  `VERCEL_BRANCH_URL` / `VERCEL_URL` values while production keeps the explicit
  canonical URL. Verified focused auth env/provider/linking tests, auth
  typecheck, portal test script, portal typecheck, and a Vercel-preview-shaped
  portal production build with branch/deployment URLs.
- 2026-07-06 Vercel clean-deploy follow-up: fixed the current
  `codex/merge-bff-betterauth` Vercel failure by making the pnpm build-script
  approval policy deterministic for clean installs. Added the missing native
  dependency build approvals to `onlyBuiltDependencies` and mirrored them as
  boolean `allowBuilds` entries for pnpm 11. Verified `pnpm --filter portal
build`, `CI=true npx -y pnpm@10.28.0 install --frozen-lockfile`, and
  `CI=true npx -y pnpm@10.28.0 --filter portal build`. Pushed commit
  `33ecda7f`; GitHub/Vercel statuses for `base`, `chat-portal`,
  `landing-page`, and `tg-mini-app` all completed successfully.
- 2026-07-06 OpenAPI CI follow-up: refreshed the checked-in backend OpenAPI
  fixture and generated client route manifest from
  `https://api-staging.aomi.dev/api/openapi.json`, adding the provider grant
  revoke route and Para auth begin/callback routes that staging exposes.
  Verified the live OpenAPI contract against staging plus the full
  `build-and-lint` workflow gates locally with pinned `pnpm@10.28.0`.
- 2026-07-07 widget proportion polish: tuned the shadcn registry widget's
  global small text scale and chat rail proportions so sidebar, trace,
  composer, wallet/auth controls, and message text read closer to standard chat
  UI proportions without a visual redesign. Verified registry build with pinned
  `pnpm@10.28.0` and targeted ESLint on touched TSX files.
- 2026-07-07 assistant turn phase polish: split chat sending into
  `submitting` vs `working` phases so the UI keeps the blinking dot only while
  the backend request is still pending, switches to a minimal Working shimmer
  after the backend accepts processing, and buffers provisional pre-tool text
  out of the final answer area. Verified focused React chat tests, React package
  build, registry build, and targeted ESLint with pinned `pnpm@10.28.0`.
- 2026-07-07 working trace interpreter follow-up: replaced icon-only trace
  guessing with a typed registry plus deterministic interpreter for web search,
  skill activation, chain context, native/token balances, token lookup,
  ERC-20/Aerodrome calls, staged transactions, simulations, and wallet approval.
  Trace rows now show concise interpreted titles with up to three under-label
  chips and `+N more` overflow while raw args/results remain expandable.
  Verified focused interpreter Vitest coverage, targeted ESLint, and registry
  build with pinned `pnpm@10.28.0`.
- 2026-07-07 trace chip cleanup: simplified skill chips to activated skill names
  only with capitalization, removed gas-price chips from network checks, and
  swapped network color dots for the existing chain logo components in trace
  chips. Verified focused interpreter Vitest coverage, targeted ESLint, and
  registry build with pinned `pnpm@10.28.0`.
- 2026-07-07 trace interpreter hardcode cleanup: removed the non-scalable
  contract/token/pool registry, protocol-specific selector handling, route
  reconstruction, and token-decimal formatting from working-trace chips. The
  interpreter now keeps only generic ERC-20 selector decoding plus structural
  result parsing, and falls back to the model-provided tool label for
  protocol-specific calls. Verified focused interpreter Vitest coverage,
  targeted ESLint, and registry build with pinned `pnpm@10.28.0`.
- 2026-07-07 trace chip polish follow-up: resolved numeric chain ids and
  lowercase network strings through shared `@aomi-labs/react` chain metadata so
  trace chips show names/logos such as Base instead of `chain 8453`, capitalized
  success/failure/status chips, and changed chip overflow to show four facts
  plus a `+N more` chip. Verified focused interpreter Vitest coverage, targeted
  ESLint, and registry build with pinned `pnpm@10.28.0`.
- 2026-07-07 trace chip semantics follow-up: replaced block `#` chips with a
  block icon plus plain number, removed nonce from native balance chips, changed
  custom/protocol EVM calls to show structural from/to address chips instead of
  selector/success chips, capitalized staged action chips, and added tx/gas
  icons for staged, simulated, and committed transaction counts. Verified
  focused interpreter Vitest coverage, targeted ESLint, and registry build with
  pinned `pnpm@10.28.0`.
- 2026-07-07 token/allowance chip polish: standardized token-related chips so
  token resolution, token balance, metadata, and allowance rows put the resolved
  chain chip first, use a generic token icon for symbols, use a user icon for
  wallet owner addresses, and omit noisy contract-address/count/value chips
  where they do not help scanning. Verified focused interpreter Vitest coverage,
  targeted ESLint, and registry build with pinned `pnpm@10.28.0`.
- 2026-07-07 token-miss chip cleanup: removed the redundant `not found` badge
  from unresolved token rows so the trace keeps only the queried token symbol.
  Verified focused interpreter Vitest coverage, targeted ESLint, and registry
  build with pinned `pnpm@10.28.0`.
- 2026-07-07 staged action chip icons: added deterministic icons for staged
  approve, swap, transfer/send, bridge, burn, mint/claim, and
  deposit/withdraw-style action chips, with a generic staged fallback for
  custom actions. Verified focused interpreter Vitest coverage, targeted
  ESLint, and registry build with pinned `pnpm@10.28.0`.
- 2026-07-08 thread refresh persistence: added widget-local active-thread
  persistence with vendor-scoped storage keys, restored valid materialized
  threads after authenticated list load, ignored empty local drafts, and fell
  back from stale stored thread ids to the newest valid regular thread.
  Verified focused React thread tests, React package build, targeted ESLint,
  and registry build.
- 2026-07-07 tool interpreter architecture planning: drafted
  `specs/TOOL-INTERPRETER-PLAN.md` from `tmp-examples.md`, current frontend
  trace behavior, and backend operation-shape exploration. The plan separates
  unwrap, normalization, family parsing, operation facts, and presentation
  rules while preserving the current `interpretToolStep()` UI contract.
- 2026-07-07 tool interpreter architecture implementation: split the shadcn
  registry interpreter into the planned unwrap, normalization, ordered pipeline,
  simple/EVM family parsers, and descriptor/chip presentation modules while
  keeping the public `interpretToolStep()` API and current EVM golden behavior.
  SVM remains reserved for the first real payload. Updated registry packaging
  so installed assistant-thread components include the interpreter module tree.
  Verified focused interpreter Vitest coverage, targeted ESLint, and registry
  build with pinned `pnpm@10.28.0`; app-wide typecheck still reports unrelated
  wallet-kit account runtime test fixture type drift.
- 2026-07-07 trace chain-chip tuning: made EVM-family trace rows show a chain
  chip whenever an explicit chain field is present, including generic
  protocol-specific calls such as quotes/pool checks, token lookup misses,
  native balance payloads that carry chain, ERC-20 approve/transfer calls, and
  pending wallet approval/commit rows. Verified focused interpreter Vitest
  coverage, targeted ESLint, Prettier, and registry build with pinned
  `pnpm@10.28.0`.
- 2026-07-07 trace status chip tuning: made status/outcome chips render last
  regardless of descriptor order and replaced status color dots with neutral
  lucide icons for queued/pending, success, failed, and revoked states. Verified
  focused interpreter Vitest coverage, targeted ESLint, Prettier, and registry
  build with pinned `pnpm@10.28.0`.
- 2026-07-07 frontend submitting fallback: added a React runtime grace timer so
  slow `/api/chat` acknowledgements keep the black submitting dot only briefly
  before promoting the visible turn to the existing Working shimmer, while
  clearing back to idle on synchronous completion or send failure. Verified
  focused React chat tests, targeted ESLint, and React package build with
  pinned `pnpm@10.28.0`.
- 2026-07-07 working shimmer timing polish: tuned the Working-label shimmer to
  use less off-screen travel, a wider highlight band, and a steadier linear
  sweep so it spends less time looking static and no longer flashes through as
  quickly. Rebuilt the shadcn registry, refreshed the landing registry mirror,
  and verified CSS formatting with pinned `pnpm@10.28.0`.
- 2026-07-07 trace icon tuning: switched approval/permit action chips and
  ERC-20 approve row icons to the clearer pencil-write icon while keeping
  allowance on the pen-line icon, and gave skill chips a distinct puzzle-piece
  capability icon instead of reusing the Activate skill sparkle. Verified
  focused interpreter Vitest coverage, targeted ESLint, Prettier, and registry
  build with pinned `pnpm@10.28.0`.
- 2026-07-07 native/staged/error chip polish: made native ETH balance chips
  render with a compact amount (for example `0.00087`), the Ethereum logo, and
  no trailing `ETH` text while leaving ERC-20 amount chips unchanged; staged
  transaction rows now show `1 tx` / `N txs`; failed tool calls now show only
  the `Failed` badge instead of the backend error code chip. Verified focused
  interpreter Vitest coverage, targeted ESLint, Prettier, and registry build
  with pinned `pnpm@10.28.0`.
- 2026-07-07 decimals chip polish: collapsed token decimals rows from separate
  `decimals` and value chips into a single numeric metadata chip such as
  `6 decimals` with a hash icon. Verified focused interpreter Vitest coverage,
  targeted ESLint, Prettier, and registry build with pinned `pnpm@10.28.0`.
- 2026-07-07 assistant footer icon polish: shrank the assistant response copy
  and rerun glyphs by half while keeping their existing button hit targets.
- 2026-07-09 CLI skills review completion: finished the remaining
  `specs/CLI-SKILLS-REVIEW-PLAN.md` items. Canonicalized the CLI default BFF
  URL to `https://chat.aomi.dev`, added `--json`/`--verbose` ergonomics, made
  account summary vs link-graph output distinct, hid local state path noise by
  default, moved deprecated embedded-provider flags out of root help's primary
  option list, made empty chat responses exit non-zero, and fixed wallet
  label/relink semantics so wallet labels live on wallet metadata while relinks
  return no-op. Refreshed both `aomi-transact` skill mirrors for JSON/verbose
  docs and reran the CLI surface verifier. Verified with auth/client focused
  Vitest suites, auth/root typechecks, client build, official SIWE auth smoke,
  built-CLI native SIWE with a private key, parseable JSON account/wallet/tx/
  app/chain output, state permissions, live wallet rename/relink checks, and a
  real local Anvil transaction submission through `aomi tx sign`.
  Verified targeted ESLint, Prettier, and registry build with pinned
  `pnpm@10.28.0`.
- 2026-07-07 final-answer streaming fix: buffered no-tool assistant text while
  the turn is still running because a later tool call can move that text into
  the Working trace, then fake-streamed the settled final answer after completion
  using the same path as post-tool answers. Fixed runtime turn merging so
  tool-bearing assistant fragments still fold into one Working-trace turn, but
  contiguous text-only assistant snapshots collapse to the latest final answer
  instead of being glued together; kept a conservative exact duplicate collapse
  for single-fragment `answeranswer` content, and retained a `lastCompletedAt`
  completion marker so late-mounted final answers still fake-stream. Cleaned up
  the intermediate UI-side fuzzy de-duping/debug scaffold so text normalization
  is owned by the runtime. Regenerated the shadcn registry payloads and landing
  public mirror; verified targeted ESLint, focused runtime tests, React package
  build, widget registry build, and generated JSON guards with pinned
  `pnpm@10.28.0`.
- 2026-07-08 empty new-chat no-op: guarded the React thread-list adapter so
  selecting New Chat from the current empty local draft leaves the thread id and
  `threadViewKey` unchanged instead of remounting/refreshing another blank
  chat. Added focused adapter regression coverage and verified with the focused
  React thread Vitest file, targeted ESLint, and React package build.
- 2026-07-09 CLI skills review phase 1: fixed expected CLI error handling so
  `fatal()` exits before citty can print stacks while Vitest keeps the strict
  `CliExit` hook; switched normal command execution to `runCommand` under the
  CLI's own catch path so HTTP 401s and missing transaction errors stay
  one-line. Added upfront EVM/Solana private-key validation for `wallet set`,
  CLI flags, and env vars; hardened CLI state storage to `0700` dirs and
  `0600` files; made logout clear stored EVM/Solana signing keys; and stopped
  persisting one-shot `--private-key` / env secrets. Verified focused CLI
  Vitest coverage, client package build, and real `dist/cli.js` smokes for bad
  provider, bad private key, missing tx, 401 chat, and no one-shot key leak.
- 2026-07-09 CLI skills review phase 0: refreshed `aomi-transact` skill docs
  and the plugin mirror against the real v0.1.42 CLI help surface. Removed
  nonexistent `wallet login` guidance, corrected app examples (`zerox`,
  `polymarket_rewards`, default-app Lido/Uniswap flows), documented the full
  account link/unlink/rename/update/delete/session-switch surface, widened the
  skill network allowlist for `chat.aomi.dev`, staging, and local dev, and
  added `scripts/verify-cli-surface.mjs` to catch command/app drift. The
  docs/help check passes; live `localhost:3000` app comparison currently fails
  because that backend exposes a stale registry, which the new check reports.
- 2026-07-10 main rebase integration: rebased `feat/working-trace-a` onto
  `origin/main`, reconciled the newer thread wire format and workspace build
  policy, regenerated client/React/registry artifacts, and migrated Smither's
  rollback flow to the current deployment-record/promote API. Updated stale UI
  timing and route assertions, aligned the local auth bootstrap with the
  consolidated account package, and added coverage for numeric/string
  `last_active_at` normalization. Verified the frozen install, lint, root and
  app typechecks, all package/app Vitest suites, package builds, and production
  builds for landing, base, portal, Aomi Build, Telegram, and Smither; the user
  also confirmed the integrated UI works in manual testing.
- 2026-07-10 wallet approval popup recovery: traced the missing web-wallet
  prompt to the local backend failing transaction-event persistence because
  `user_transactions.application_id` was absent. The local stack bootstrap had
  preferred the lagging `db-master` migrations over the migrations paired with
  the running `product-mono` backend. Switched the bootstrap source order,
  added attribution-column/index convergence checks, applied the missing July 7
  migrations to `aomi_local`, and verified in the user's signed-in Chrome flow
  that a fresh 1-wei Base request opens Rabby approval without broadcasting it.
- 2026-07-10 message edit/rerun recovery: implemented the assistant-ui external
  runtime's missing edit and reload capabilities, rewound visible history to
  the selected user turn, and projected new backend turns in place of superseded
  responses. Persisted compact raw-message branch ranges so the selected edited
  path survives reload without storing message content locally. Added focused
  edit, rerun, and remount regression coverage; verified React tests, targeted
  ESLint, root and portal typechecks, React/registry builds, and signed-in Chrome
  E2E for rerun, editing FIRST to SECOND/THIRD, and post-edit page refresh with
  no new runtime-capability errors.
- 2026-07-10 release/PR preparation: audited every changed workspace against
  the npm publish workflow and registry. Patch-bumped the three changed
  published packages to `@aomi-labs/client@0.3.1`,
  `@aomi-labs/react@0.5.1`, and `@aomi-labs/widget-lib@1.4.1`; rebuilt their
  artifacts and verified packed tarballs. The changed account and smither
  workspaces are not npm-published, and product-mono has no changed npm
  package. Re-ran frontend lint, package builds, 656 root tests, 221 registry
  tests, and the landing production build before draft PR publication. Opened
  related draft PRs `aomi#304` and `product-mono#780`, with reciprocal links
  and coordinated review/deploy notes.
- 2026-07-13 chat-polish restoration: replayed the complete change set from
  merge commit `17e9bab9` onto current `origin/main` on
  `restore-chat-polish`, preserving the newer thread-era endpoint work while
  restoring assistant-ui 0.14, thread persistence/recovery, the animated
  Working trace, modular tool interpretation, LI.FI presentation, archive-only
  thread actions, generated registries, CLI hardening, and associated package
  updates. Verified frozen install, full lint, library/portal/landing typechecks,
  client/React/registry and landing builds, 682 root tests plus 221 registry
  tests (including the LI.FI interpreter cases), and a signed-in Chrome flow:
  zero trash/delete thread controls, animated trace rows/chips, and a live
  LI.FI ETH-to-USDC quote with no transaction staging or signature request.
- 2026-07-13 PR #329 main sync: merged the latest `origin/main` into
  `restore-chat-polish` without conflicts, retaining the restored chat polish
  alongside the newer Build P1 control-plane work. Re-ran the exact CI workflow
  locally: frozen install, lint, library and deploy builds, 682 root tests, 221
  registry tests, registry build, landing production build, and the live
  staging OpenAPI contract all passed before pushing the refreshed branch.
- 2026-07-13 working-trace scroll: kept long Working traces capped at 260px but
  made the capped region wheel, touch, and keyboard scrollable with hidden
  cross-browser scrollbars. Replaced the previous CSS mask with a
  pair of pointer-transparent, theme-background edge fades so Chrome hover-wheel
  hit-testing reaches the trace while rows dissolve cleanly at both edges without
  smearing text; the bottom fade appears only while more content exists below, so
  the newest step is fully clear at the scroll end;
  preserved auto-follow for the newest live step unless the reader scrolls up,
  and kept Show all / Collapse to recent behavior. Verified targeted ESLint,
  registry build, portal typecheck, all 221 registry tests, and a signed-in
  Chrome E2E against the local dev auth stack using an existing 19-step trace.
- 2026-07-13 working-trace npm follow-up: audited the merged feature against the
  main-branch npm workflow and confirmed only `@aomi-labs/widget-lib` ships the
  touched source. Patch-bumped it from `1.4.1` to `1.4.2` and added a repository
  rule requiring relevant publishable npm workspaces to be version-bumped before
  future merges rather than corrected afterward.
- 2026-07-14 PR #336 main sync: merged `origin/main` into
  `feat/required-secrets-gating`, preserving required-secret activation and
  promotion gating across the newer Build control-plane UI. Resolved the
  launch UI/type conflicts, fixed the merged usage-summary accumulator typing,
  and verified focused Build tests, deploy package tests, the Aomi Build
  typecheck, and the deploy package build.
- 2026-07-26 settings redesign frontend correctness: scoped the shared account
  overview to adapter-account transitions and fenced stale in-flight responses;
  made package full-set replacements wait for an authoritative account
  baseline, serialize writes, and refresh the shared account snapshot; derived
  cached statements from current allowance data; and preserved provider/payment
  dimensions so mixed BYOK and managed model rows render independently. Added
  timing and account-switch regression coverage; corrected the live-data error
  message; and patch-bumped the changed widget package to `1.4.13`. Verified
  302 Portal tests, Portal type-check, repository lint, and `git diff --check`.
  After the first refreshed preview exposed undeclared Para runtime imports,
  made the exact `core-sdk` and `user-management-client` versions available
  from the workspace root so Para's nested packages resolve them in clean pnpm
  installs, then reproduced the production Telegram build.
- 2026-07-26 Builder CLI authentication cleanup: reused the existing Build
  GitHub OAuth callback for CLI authorization, limited CLI sessions to deploy,
  deployment-status, and activate scopes, made exchange retries idempotent,
  and preserved partner platforms in project links and detail lookups. Verified
  type-check, lint, all 331 Build tests, and the production Build bundle.
- 2026-07-27 partner-payment visibility: exposed validated app pricing and the
  durable partner ledger in Project Home, Usage, Logs, Transactions, and
  Observability. Recipient-bucket settlements and outstanding balances are
  explicitly labeled and deduplicated across projects, while configured prices
  remain visible before the first successful paid call. Cross-project payout
  and log rows are deduplicated while advancing every affected project cursor.
  Patch-bumped `@aomi-labs/deploy` to `0.3.1` after `main` advanced to `0.3.0`.
  Synced the PR with the July 27 frontend changes and updated the full-suite
  bootstrap contract to assert the new nullable pricing field. Verified root
  lint, Build type-check, deploy/client/React/registry builds, 1,390 tests, and
  the Landing production build.
- 2026-07-31 mother-commit orchestration client: removed delegated child-wallet
  auto-signing and child callback routing, restored every wallet request to the
  owning session queue/callback path, retained `WalletRequestTarget` only as a
  deprecated compatibility export, and versioned `@aomi-labs/client` at 0.4.0.
  Replaced the v1 child-routing tests with an ordinary mother-session callback
  test and a CLI E2E that receives a two-transaction mother batch, resolves it
  through the normal signing API, verifies session-thread/app-scoped callback
  delivery, and observes the resumed final state. Client build/declarations,
  library typecheck, and all 59 focused tests passed.
- 2026-08-13 launch install recovery, bfcache branch: the "Already installed —
  continue" escape hatch was disabled by the very state it exists to escape.
  `beginInstall` sets `installing` and navigates to GitHub; when the App is
  already installed GitHub renders its configure page, which never redirects
  back, so the only way out is Back — and a bfcache restore does not remount
  Onboarding, leaving the hydrate effect unrun and `installing` stuck true.
  Added a `pageshow`/`persisted` handler that clears the in-flight install on
  restore only, plus a colocated RTL spec covering both branches (restore
  clears it; an ordinary non-persisted pageshow does not). The spec was
  mutation-tested: neutering the handler fails the restore case and passes the
  control case. Verified with the full launch suite, 32 files / 191 tests.
