---
title: Auth
owner: frontend
status: authoritative
area: auth
review_after_days: 30
sources_of_truth:
  - packages/auth/src/account.ts
  - packages/auth/src/better-auth/auth.ts
  - packages/auth/src/better-auth/provider-plugin.ts
  - packages/auth/src/service/account-service.ts
  - packages/auth/src/service/provider-exchange.ts
  - packages/auth/src/types.ts
---

# Auth

## Overview

`@aomi-labs/account` owns account auth: Better Auth sessions, SIWE/SIWS,
provider-token sign-in/linking, anonymous users, OAuth Provider 1.7, and
canonical Aomi account resolution.

One Better Auth issuer now serves Agent REST, Pipeline REST, Agent MCP, and
Pipeline MCP. It uses the official OAuth Provider, MCP, CIMD, JWT/JWKS,
Anonymous, Bearer, and device-authorization components. The four exact
resources and scope vocabulary live in `better-auth/oauth-policy.ts`; custom
Aomi token, refresh, registration, PKCE, or revocation implementations are not
part of this architecture.

## Source Map

- [packages/auth/src/account.ts](../../../../packages/auth/src/account.ts)
- [packages/auth/src/better-auth/auth.ts](../../../../packages/auth/src/better-auth/auth.ts)
- [packages/auth/src/better-auth/provider-plugin.ts](../../../../packages/auth/src/better-auth/provider-plugin.ts)
- [packages/auth/src/service/account-service.ts](../../../../packages/auth/src/service/account-service.ts)
- [packages/auth/src/service/provider-exchange.ts](../../../../packages/auth/src/service/provider-exchange.ts)
- [packages/auth/src/types.ts](../../../../packages/auth/src/types.ts)

## Key Flows

### Account Sign-In

Better Auth owns browser/device sessions. SIWE sign-in verifies an ERC-4361 message through the Better Auth SIWE plugin. Privy/Para token sign-in goes through the Aomi provider plugin, which verifies the provider token server-side, creates or finds a Better Auth user, links the provider identity in the `aomi_*` graph, syncs attested provider wallets, and sets the Better Auth session cookie.

### OAuth and backend bearer handoff

Public OAuth access tokens are verified at the portal for the exact resource,
business scope, and optional DPoP proof. Session and anonymous Bearer callers
remain supported only on REST. The portal maps the Better Auth subject to the
canonical Aomi UUID, strips the public credential, and mints the existing
`aud=aomi-api-server` assertion with downscoped resource, scope, client,
auth-source, and user/guest context. Rust verifies and narrows that context
again before minting `aud=aomi-backend`. A public OAuth token never reaches
Rust.

Anonymous account upgrades run through Better Auth `onLinkAccount`. The
canonical identity rows are relinked transactionally before Better Auth deletes
the old anonymous user; OAuth sessions, refresh tokens, access tokens, and
consents cascade from that old user. A verified subject already owned by a
different canonical UUID fails with the explicit merge-required recovery path.

JWT/JWKS is public OAuth plumbing only. Backend identity still crosses the
service mesh through the Aomi EdDSA signer, never through `/api/auth/token`.

### Providers

Privy and Para provider verification lives under `packages/auth/src/providers/`. Provider tokens are verified server-side before account sign-in or linking, and provider-attested wallets are synced only when the corresponding REST credentials are configured.

## Operational Notes

- Raw provider credentials must never be returned to MCP callers or persisted in approval rows.
- Raw Privy/Para tokens must never be stored in Aomi account tables.
- `PORTAL_SERVICE_PRIVATE_KEY` provides the portal BFF's Ed25519 signing key. The matching public key lives in `packages/account/src/topology-data.ts` and the backend `service.toml`.
- Privy and Para verification keys/secrets are server-only and must not be exposed to the browser.

## Related Topics

- [auth/facts/wallet-kit.md](wallet-kit.md)
- [auth/facts/base-account.md](base-account.md)
- [client-runtime/facts/react-runtime.md](../../client-runtime/facts/react-runtime.md)
