---
title: Canonical Chat Issuer Transition
owner: frontend
status: authoritative
area: bff
review_after_days: 14
sources_of_truth:
  - apps/edge/src/auth/origin.ts
  - apps/edge/src/auth/server.ts
  - apps/edge/src/portal/context.ts
  - packages/account/src/better-auth/env.ts
---

# Canonical Chat issuer transition

The chosen primary authentication base is `https://aomi.chat`. The current OAuth
protocol issuer includes the existing `/api/auth` base path, so its canonical
identifier becomes `https://aomi.chat/api/auth`. Code support does not activate
that origin: production and staging retain their committed deployment values
until the corresponding release gate passes.

## Bounded legacy authority

Published clients validate discovered issuers against their configured origin.
Changing discovery on the old hostname immediately would break those clients.
An optional `PORTAL_LEGACY_AUTH` JSON setting therefore keeps the old authority
on its own admitted HTTPS host for an explicit interval:

```text
BETTER_AUTH_URL=https://aomi.chat
PORTAL_HOSTS=aomi.chat,chat.aomi.dev
PORTAL_LEGACY_AUTH={"origin":"https://chat.aomi.dev","expiresAt":"<approved UTC timestamp>"}
```

This is environment inventory pushed by the deployment pipeline, not a local
secret or dashboard setting. There is no default compatibility interval. The
origin must differ from the primary, both hosts must be admitted, and paths,
wildcards, unknown fields and invalid/absent deadlines fail closed.

During the interval the new host issues only its new authority and resources.
The old host retains old issuance, refresh, discovery and validation for existing
clients. It is never an additional issuer accepted on the new host. Every
request retains its real browser origin and DPoP URL. Neither audience nor scope
checks are widened. An admitted request selects one authority for its lifetime;
a later request reevaluates the deadline. Cached auth instances are keyed by
both wallet domain and selected authority so an old instance cannot outlive the
migration policy through cache reuse.

Downstream account helpers use request-scoped configuration rather than mutating
process.env. This isolates policy in concurrent requests and preserves the
canonical and legacy protected-resource discovery documents. The mechanism is
shared with the request-environment foundation proposed in aomi #854; this change
does not activate a separate API-host authority or change client defaults.

After the deadline, the old host no longer issues/validates as the legacy issuer.
Clients pinned to the old issuer must have upgraded or deliberately signed in
against the new origin. Continuing to refresh during a legacy interval can
extend refresh-token lifetimes; merely waiting one TTL is not a drain strategy.
Current source config uses 5-minute access tokens and 7-day sessions; the pinned
OAuth provider defaults refresh tokens to 30 days. These settings do not prove
the ages or expiries of grants already stored in production.
Before choosing the cutoff, inspect real grant usage and decide the new-issuance
freeze, client notice and reauthentication policy. Do not silently accept tokens
from either issuer on every transport host to conceal a migration failure.

## Sessions, providers and rollback

Cookies remain host-scoped. A new-host sign-in is required; this code neither
copies cookies across domains nor relies on third-party cookies. GitHub/social
callbacks and wallet provider origins must be prepared for the actual new hosts.
Reuse the correct auth secret and signing material; a lost value requires a
planned coordinated rotation, not an arbitrary replacement.

Before activating the new primary, verify new and legacy SDK/CLI/MCP clients,
PKCE/device/refresh flows, resource/audience and DPoP rejection, wallet login and
canonical account continuity, logout, provider callbacks and cookies through the
public proxy. Page routing and old-page redirects remain separate gates. Changing
SDK/CLI defaults requires its own package release after production acceptance.

Rollback must restore a compatible issuer/Edge/page tuple and preserve the keys
needed to validate both credential populations. Restoring an old binary alone
may strand new credentials. A backend rollback must not blindly replace the
qualified Edge. No new database schema is introduced here.

## Local evidence

`node scripts/test-issuer-cutover.mjs <loopback PostgreSQL port>` runs the real
Edge suite, including issuer migration and device-flow fixtures, against the
existing local test service. The harness creates and removes a random base
database; suites that need separate schemas own additional random databases, leaving
workspace and hosted schemas untouched. It covers wallet/account continuity,
host-scoped cookies, DCR/device issuance, exact JWT issuer/audience/signature,
refresh rotation and replay rejection, and discovery on both origins. Unit
coverage additionally checks policy validation, cross-host token rejection,
deadline expiration, auth cache selection and concurrent request isolation.

These are local proofs, not provider login, hosted acceptance or a production
cutover report. The example deadline is deliberately a placeholder; dates in
unit fixtures are test inputs, not an approved rollout schedule.
