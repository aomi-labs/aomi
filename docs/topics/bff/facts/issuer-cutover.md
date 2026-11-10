---
title: OAuth Issuer
owner: frontend
status: authoritative
area: bff
review_after_days: 30
sources_of_truth:
  - apps/edge/src/auth/server.ts
  - apps/edge/src/portal/context.ts
  - packages/account/src/better-auth/env.ts
  - scripts/test-issuer-cutover.mjs
---

# OAuth issuer

The Edge trusts exactly one OAuth issuer: the auth base in `BETTER_AUTH_URL`
with the path `/api/auth`. There is no secondary issuer and no grace period. A
token minted under any other issuer fails issuer and resource validation.

## Alias hosts

A host the portal admits as an alias uses the same issuer and the same
protected resources as the auth base. The request URL is left unchanged, so
browser origin checks, DPoP and wallet proofs still bind to the host the
request arrived on.

## Sessions

Cookies are host-scoped. A session on one site does not carry to another, so
`aomi.chat` and `aomi.build` each need their own sign-in.

## Request-scoped configuration

Account and OAuth policy read their environment through `withAccountAuthEnv`,
which is scoped to one request, and fall back to `process.env` outside a
request. Concurrent requests do not share it.

## Local verification

`node scripts/test-issuer-cutover.mjs <loopback PostgreSQL port>` runs the Edge
suite against a disposable local database. It covers wallet login and session,
DCR and device issuance, exact JWT issuer, audience and signature, refresh
rotation with replay rejection, and discovery. Unit tests reject tokens from
another issuer on both the auth base and alias hosts. This is a local check; it
does not exercise hosted callbacks or real browsers.

The move of the auth base to `https://aomi.chat` is planned in
[the issuer cutover plan](../plans/2026-11-10-issuer-cutover.md).
