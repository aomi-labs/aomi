# Portal account choice

The shared widget OAuth bootstrap previews server-verified canonical accounts
before accepting a choice. This is account switching, never account merging.

- Signed out: confirm the incoming app account to create a portal session.
- Same canonical account: preserve the existing portal session.
- Different accounts: choose the app account for the portal, or continue the
  authorization as the existing portal account.
- Cancel: no ticket redemption and no session changes.

`POST /api/auth/aomi/widget-bootstrap/preview` accepts the existing ticket,
origin, state and channel nonce. It does not consume the ticket. Its no-store
response contains `widget`, `portal` (nullable), and `sessionVersion` (nullable).
Account labels and canonical IDs are resolved on the server.

`POST /api/auth/aomi/widget-bootstrap/redeem` requires the same binding plus
`confirmed: true`, `account: "widget" | "portal"`, and the preview's
`sessionVersion`. It rechecks the live portal session, originating widget session,
identity and managed-client policy before atomically consuming the ticket.
Changed sessions fail with `portal_session_changed`; the user must restart.
Expiry, replay and revoked bindings fail closed. Keeping the portal account does
not relink the incoming wallet, alter a balance or create another portal session.

The existing OAuth consent and PKCE/DPoP exchange follow this choice. The browser
SDK verifies the issuer, audience and signed canonical-account claim and exposes
`grant.accountId`. Refresh cannot change that account. `subject` remains only a
caller cache partition. Hosts must dispose prior transports and isolate saved
campaigns before adopting a different account.

The Fuzzer companion integrates both choices and first-party account/credits
navigation. `expectedAccount` prevents a raced Portal identity from silently
opening another account's checkout. The two thread setup POST routes accept the
same Agent write grant as campaign requests; unrelated routes remain closed.

Browser acceptance found and fixed three problems: bootstrap policy incorrectly
excluded offline_access; native browser fetch was called with an options-object
receiver; Next's internal host differed from the configured public DPoP URL.
Proof verification uses the configured origin, never forwarded host headers.

Deploy Portal and account together. Publish client 0.11.2 and the corresponding
React/widget release before merging the dependent Fuzzer update. No account
merge, financial migration or production configuration changes are included.

## Reproduce the local browser acceptance

Use a disposable loopback Postgres database. Set ACCOUNT_CHOICE_DATABASE_URL and
AOMI_TEST_DATABASE_DISPOSABLE=1. Apply the existing browser-contract migration
with that URL as DATABASE_URL. In separate terminals in this checkout run:

```sh
pnpm exec tsx tests/e2e/fuzzer-account-choice-portal.ts
pnpm exec tsx tests/e2e/fuzzer-account-choice-fixtures.ts
```

In the companion Fuzzer checkout, install the candidate SDK packages, set
AOMI_WIDGET_ROOT to this checkout, then run Vite with
`apps/web/tests/account-choice.vite.ts` from apps/web. Open
http://127.0.0.1:3420/account-choice.html. The fixtures use deterministic test
wallets and real Better Auth, managed-client policy, PKCE, DPoP and canonical
identity resolution. The Agent upstream is a fixture that verifies delegated
BFF assertions, not the production execution backend. The upstream prints its
loopback URL; /__records contains redacted principal evidence.

See the companion's docs/evidence/account-choice for the browser matrix,
screenshots and safe principal evidence. No live credentials or payments are
used. Full deployed Fuzzer/Arc campaign acceptance remains a release gate.
