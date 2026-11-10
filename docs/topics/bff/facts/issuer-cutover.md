---
title: Canonical Chat Issuer Cutover
owner: frontend
status: authoritative
area: bff
review_after_days: 14
sources_of_truth:
  - apps/edge/src/auth/server.ts
  - apps/edge/src/portal/context.ts
  - packages/account/src/better-auth/env.ts
---

# Canonical Chat issuer cutover

The approved authentication base is `https://aomi.chat`, with OAuth issuer
`https://aomi.chat/api/auth`. Cecilia explicitly rejected legacy issuer
compatibility. There is no grace period, secondary issuer, or old-host token
acceptance. Admitted aliases use the configured canonical issuer too.

Existing clients must update their authentication origin and sign in again.
Old-origin access tokens are rejected by issuer/resource validation. Existing
client registrations and refresh grants must be inventoried before activation;
no old grant portability is promised. SDK/CLI defaults must move to aomi.chat in the cutover release.
Old domains may redirect pages, but must not serve legacy authentication or apps. This PR prepares runtime code and tests; it does not change live config.

Account policy runs in request-scoped configuration rather than process-wide
state, including under concurrent requests. No database schema change is needed.
The account package is versioned and packed with this server export.

Before activation, verify social/GitHub callbacks, Manager redirects, Para/Privy
origins, discovery, strict issuer/resource/audience checks, and real browser
sessions on aomi.chat and aomi.build. These are separate sites with host-scoped
cookies; signing in again is expected and shared cookies are not promised.

Rollback must restore an explicitly tested issuer/Edge/page tuple. Reverting the
issuer invalidates new-issuer clients; do not silently enable dual trust. Preserve
signing keys and account data, and communicate the required reauthentication.

## Local verification

`node scripts/test-issuer-cutover.mjs <loopback PostgreSQL port>` runs the Edge
suite against an owned disposable local database. It exercises canonical wallet
login/session, DCR/device issuance, exact JWT issuer/audience/signature, refresh
rotation/replay rejection, and discovery. Unit tests reject old-issuer tokens on
both the canonical host and admitted aliases. These are local proofs, not hosted
callback/browser acceptance or evidence of production activation.
