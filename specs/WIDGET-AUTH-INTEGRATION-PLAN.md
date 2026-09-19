# Aomi Widget Authentication — Integration Plan (Rev 2, code-mapped)

> Status: **IMPLEMENTED; LIVE E2E IN PROGRESS (2026-07-22).** Rev 1 was verified against code on 2026-07-21; Rev 2 added the provider-agnostic contract and was implemented across `aomi`, `db-master`, and `product-mono`. Phase 0's Para cross-tenant experiment passed. `http://localhost:3001` is now authorized in the Landing Para project and the Google OAuth popup reaches Para's wallet-selection screen. The remaining live gate is to finish the user-controlled wallet selection, then complete the consumer WST/thread, harmless-signing, and sign-out checks below.
> Branches: `aomi:codex/widget-auth-single-tenant`, `db-master:codex/xrepo-db-migration-replay`, `product-mono:codex/solana-backend-e2e`.
> Sources: PR #339 (`codex/landing-auth-parity`, tip `2487a5b9`) and PR #355 (`codex/widget-cross-domain-auth`, tip `a586b016`), plus net-new work.
> Supersedes Rev 1's phase list; folds in code-verification corrections, the SIWE/SIWS linking mechanism, and the multi-provider generalization.

---

## 0. Objective

An unrelated HTTPS site can embed `AomiWidget`, authenticate users through **its own identity-provider project** (Para first; Privy and others later) or external-wallet SIWE/SIWS, and those users get **one global Aomi account** — the same `users.id`, permissions, threads, and account routes as on Aomi's native site.

```tsx
<AomiWidget
  apiUrl="https://chat.aomi.dev"
  auth={paraAuth({
    apiKey: import.meta.env.VITE_PARA_API_KEY,
    environment: "PROD",
  })}
/>
```

The consumer provides only their browser-visible provider key + environment. No Aomi integration key, no provider server secret, no JWKS URL, no cross-site BetterAuth cookie.

### One auth model, two session carriers

There is **no split** in identity, permissions, accounts, or routes between native and embedded users. The only split is the token carrier, forced by browser physics (third-party cookies are blocked on consumer origins):

```text
aomi.dev (native)                 consumer.com (embedded widget)
  BetterAuth login                  Provider credential  |  SIWE / SIWS
  session cookie (same-origin)      Widget Session Token (bearer, origin-bound, 30 min)
        \                                /
         resolvePortalPrincipal()  — cookie or WST, same answer
                    |
          one canonical users.id   — same account, same permissions
                    |
          AccountBearer -> Rust backend   (backend never sees either token)
```

Do not introduce: a `consumer` role, consumer-only scopes, reduced permissions, separate accounts per consumer, or special native-site permissions.

---

## 1. Provider abstraction — the contract everything hangs on

**Do not overfit to Para.** Para is the first registry entry, not the shape of the system. The codebase already has the right seams on both sides; this plan extends them instead of adding Para-shaped parallel paths.

Providers differ along four independent axes. Each axis is a field of a per-provider descriptor, never an `if (provider === "para")` in shared code:

| Axis                               | Para                                                                                        | Privy                                                             | Future provider                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Credential verification**        | RS/ES JWT vs remote JWKS (env-global URL)                                                   | ES256 JWT vs static SPKI key, `iss: "privy.io"`                   | possibly opaque token + introspection call — verification must be an async black box |
| **Key scope**                      | environment-global (one JWKS for all projects in BETA/PROD)                                 | tenant-scoped (verification key is per app-id)                    | either                                                                               |
| **Subject scope**                  | `sub` global per environment (proven by Phase-0 experiment) → cross-tenant matching allowed | DID (`did:privy:…`) is app-scoped → cross-tenant matching **off** | declared per provider, default off                                                   |
| **Browser credential acquisition** | `useIssueJwt()` → session JWT + keyId                                                       | `getIdentityToken()` / `getAccessToken()`                         | plugin's business (frontend adapter)                                                 |

### 1a. Backend contract (`packages/account`)

Main already has a verifier registry: `verifyProviderCredential()` + `createDefaultProviderCredentialVerifiers()` in `packages/account/src/providers/account-credentials.ts` supports **both Para and Privy today** (native, single-tenant). The work is to open it up and make it tenant-aware, not to build a new one.

New type (Phase 3), `packages/account/src/providers/descriptor.ts`:

```ts
export type VerifiedProviderIdentity = {
  provider: string; // "para" | "privy" | ...
  issuerEnvironment: string; // "para:beta" | "para:prod" | "privy:prod" | ...
  tenantId: string; // Para aud / Privy appId — the consumer project
  subject: string; // Para sub / Privy DID
  expiresAt: number;
  email?: { value: string; verified: boolean }; // display metadata ONLY
  walletAttestations: AttestedWallet[]; // shape-validated; trust per policy
  metadata: Record<string, unknown>;
};

export type WidgetProviderDescriptor = {
  id: string;
  /** zod arm for the exchange route's discriminated body — wire format is provider-owned */
  credentialSchema: z.ZodType<{
    provider: string;
    environment: string;
    provider_token: string;
    key_id?: string;
  }>;
  /** async black box; server-side key material only (pinned registry or per-tenant fetch) */
  verifyWidgetCredential(input: {
    environment: string;
    providerToken: string;
    keyId?: string;
  }): Promise<VerifiedProviderIdentity>;
  policy: {
    /** may (provider, issuerEnvironment, subject) match across tenant_id? Para: true. Privy: false. */
    subjectIsEnvironmentGlobal: boolean;
    /** which wallet claims (if any) are durable — pending the wallet-claim classification even for Para */
    walletClaimTrust: "none" | "embedded-attested";
    /** widget availability gate; Privy ships as `provider_not_enabled` in v1 */
    widgetEnabled: boolean;
  };
};
```

Registry lookups replace every closed literal union. The resolver (Phase 2), exchange route (Phase 5), and WST ticket (Phase 4) consume only `VerifiedProviderIdentity` + `policy` — they must never name a provider.

Closed unions to open (found in mapping; these are the current blockers to a third provider):

- `AccountCredentialProvider = "privy" | "para"` and the 2-arm `AomiAccountCredential` union — `packages/account/src/types.ts:117-130`.
- `normalizeCredential()` branches on `privy`/`para` for tokenKind defaults — `account-credentials.ts:302-326` → becomes descriptor-owned.
- Exchange body `z.discriminatedUnion` hardcoding `privy`/`para` — `better-auth/provider-plugin.ts:29-41` → registry-composed schema.
- `createDefaultProviderCredentialVerifiers`/`createDefaultWalletAttesters` fixed keys — extension via descriptor registration.
- Para quirk to quarantine: the `paraAudience` env fallback chain (`PARA_JWT_AUDIENCE` → … → `NEXT_PUBLIC_PARA_API_KEY`, `better-auth/env.ts:53-59`) stays native-path-only; the widget path never reads an audience from env.
- Para `userIdentifierType: "CUSTOM_ID"` hardcode in `default-wallet-attesters.ts:28` — moot for widgets (REST attestation disabled) but flag it.

### 1b. Frontend contract (`apps/shadcn-registry` wallet-kit + `packages/client`)

The wallet-kit is **already plugin-based**: `WalletProviderPlugin` + `registerWalletProvider()` in `src/lib/wallet-kit/providers/plugin-registry.ts:23-77`; the router (`config/AomiWalletKitProvider.tsx`) never names para/privy. Each plugin's `AuthRuntime` (`composer/types.ts:33-51`) already exposes the provider-agnostic credential hook: `getCredential(): Promise<AomiAccountCredential | null>`.

The transport seam also already exists: `AomiClientOptions.getAccountBearer` (`packages/client/src/types.ts:48-51`) → `wrapFetchWithAccountBearer` (`client.ts:237-267`, attaches `Authorization`, single 401 retry with `forceRefresh`) → REST + SSE. **The widget transport is a new `GetAccountBearer` implementation that returns the WST instead of an AccountBearer.** No runtime changes needed — `clientOptions` flows into `AomiClient` untouched (`packages/react/src/runtime/aomi-runtime.tsx:98-115`; the root `src/` runtime is stale).

The generalized adapter (Phase 6) is therefore small:

```ts
export type WidgetAuthAdapter = {
  kind: string; // "siwe" | "siws" | providerId
  getFingerprint(): string | null; // cache key: chainId:address or provider:subject
  exchange(input: {
    baseUrl: string;
    forceRefresh?: boolean;
  }): Promise<WidgetSession>;
  signOut?(): Promise<void>;
};
```

- Provider-credential adapter: wraps any plugin's `AuthRuntime.getCredential` → POST `/api/auth/widget/exchange`. One implementation serves Para, Privy, and any future plugin.
- Wallet adapters: SIWE/SIWS challenge flows (port of #355's `packages/client/src/widget-session.ts`, generalized from its SIWE-only shape).

Frontend closed unions to open:

- `AomiAccountCredential` 2-arm union — `src/lib/wallet-kit/types.ts:274-285` (a looser open copy already exists at `packages/client/src/account-session.ts:3-8`; converge on the open shape `{ provider: string; tokenKind?: string; providerToken: string; keyId?: string }`).
- `ProvidersConfig` hardcoded `para`/`privy` keys — `config/types.ts:32-50` (index signature exists; make the typed helpers generic).
- `paraAuth()`/`privyAuth()` stay as thin sugar over a shared `providerAuth(id, opts)` factory; per-provider defaults (Para's `methods: ["email","google"]`) live in the provider's own module.

---

## 2. Verified current state (what the code actually is)

Corrections and load-bearing facts — do not re-derive:

1. **`findConsistentSignalOwner()` does not exist.** The only owner lookup is the private `findFirstSignalOwner()` (`packages/account/src/service/account-service.ts:192-207`), sole caller `getOrCreateAomiUserForBetterAuthSession` (:108) — first-match-wins, exactly what this plan forbids. The Phase 2 resolver is **net-new code**.
2. **Auth/identity code lives in `packages/account/`** (`packages/auth` is an empty stub). Key symbols: `SignalRef` (`src/types.ts:157-169`), `DbAomiAuthIdentity` (:35-46); `upsertAuthIdentity()` (`src/db/queries.ts:248-298`, conflict target `(provider, subject) where subject is not null`, same-owner guard throws `identity_already_linked_to_another_account`), `findSignalOwner()` (:185-230), `countLoginFactors()` (:232).
3. **The package is already dual-provider (native path).** `verifyProviderCredential` registry (`providers/account-credentials.ts:57-96`), `verifyParaJwt` (`providers/para.ts:31-73`), `verifyPrivyToken` (`providers/privy.ts:61-110`, ES256 + static SPKI + `iss:"privy.io"` + `aud:appId`, DID subjects), `linkProviderIdentity` (`service/account-service.ts:414-474`), `exchangeProviderForExistingSession` (`service/provider-exchange.ts:89-126`), HTTP entry `aomiProviderAuthPlugin` (`better-auth/provider-plugin.ts:43-154`).
4. **Identity storage**: everything in `auth_providers` (+ wallets in `public_keys`). Subjects: SIWE `eip155:*:<addr>`, SIWS `solana:*:<addr>`, provider identities raw (`did:privy:…`, Para user id). Provider canonicalization `better_auth`→`betterauth` (`queries.ts:903`). `unlinkAuthIdentity`/`renameAuthIdentity` protect `better_auth|siwe|siws|email` by name (:697-702, :727-732) — new providers are automatically unlinkable MFA factors.
5. **Schema source of truth is `db-master`** (`db-master/migrations/`); product-mono mirrors in `product-mono/aomi/crates/database/src/schema.rs`. Table renamed `auth_identities`→`auth_providers` by `20260701010000_account_model_consolidation.sql`. Phase 1 touches three repos.
6. **The consolidation migration deliberately DROPPED per-app scoping** to make subjects global. Adding `tenant_id` consciously reverses that at the _constraint_ level while keeping resolution global at the _query_ level (per provider policy). Record the reversal in the new migration; do not rewrite the applied one.
7. **PR #339 is smaller to port than its diff suggests.** Already on main: `provider-exchange.ts`, `account-credentials.ts`, `aomi-backend-client.ts` (`src/lib/wallet-kit/account/`, cookie-only `fetchJson` with `credentials:"include"` at :188-207), the para/privy plugin dirs, `./providers/para` + `./providers/privy` export subpaths (source-level; build is `scripts/build-registry.js` — **there is no tsup on main**; #339's `tsup.config.ts`/package-dist work must be re-evaluated at port time, not assumed). Net-new to port: `aomi-widget.tsx`, `paraAuth()`/`privyAuth()` helpers, `apps/widget-consumer/`.
8. **PR #355 verified clean end-to-end** (single commit): `aomi_wst_` prefix, SHA-256-hashed storage in `ba_verifications` (zod ticket store, no new schema), 30-min TTL, atomic nonce consume, origin-bound resolution, credentialless CORS with `Vary: Origin`. Its `principal.ts` imports `@portal/lib/aomi-account/canonical-session`, which moved on main to `apps/portal/src/server/canonical-session.ts` (exports `resolveBetterAuthCanonicalUserId`). Its client `widget-session.ts` is SIWE/EOA-only — generalized in Phase 6.
9. **Portal today**: every `/v1/account/*` route resolves via BetterAuth cookie (`requireAomiSession`/`getBetterAuthSession` from `lib/aomi-account/session.ts`). Proxy = `createBackendProxy` (`packages/account/src/proxy.ts:238-317`): allowlist → strip `authorization`/`cookie` → `mintAccountBearer(canonicalId)` (EdDSA, `sub`=users.id, `aud:"aomi-backend"`, 15-min TTL, `bearer.ts:8-43`) → forward. No portal-wide CORS today (same-origin only).
10. **`apps/portal/src/app/api/auth/widget/{exchange,session,siwe/*,siws/*}/` exist as EMPTY untracked scaffold dirs** — the target layout is pre-created (note it already includes `exchange/` and `siws/`, which #355 didn't have); fill them in Phases 4-5.
11. **Para verifier today is single-tenant**: `env.paraAudience` fallback chain + required `PARA_JWKS_URL` (`account-credentials.ts:134-171`). Para REST secret **`PARA_API_SECRET_KEY`** (`listParaWalletsForUser`) — disabled for widgets in this effort.
12. **The first real cross-project BETA experiment passed** (two audiences, same `sub`/`data.userId`; `data.wallets` project-specific, `connectedWallets` session-specific). Harness: `apps/landing/app/dev/para-cross-project/` + `apps/landing/app/api/dev/para-jwt-compare/`; never persists raw JWTs.

### Locked decisions

- **Email is never an ownership proof.** No verified flag in provider tokens; pregen identifiers attacker-settable. Token email is display metadata only. (Today's `emailVerified: Boolean(nestedEmail)` in `para.ts` is exactly the anti-pattern; the widget path must not inherit it.)
- **JWT wallet arrays are not the cross-consumer identity key.** `data.wallets` differs by project; `connectedWallets` is session state. No wallet claim is a durable resolution signal until a dedicated claimed-vs-pregen classification is done (still open after the Phase-0 pass); never `connectedWallets`.
- **Cross-tenant subject matching is per-provider policy**, on only where proven. Para within one environment: PROVEN (Phase 0 passed 2026-07-22) — enabled. Privy ships with it off. Never match across issuer environments.
- **Linking rules match the existing product.** Authenticated principal + verified provider credential attaches a new identity; adding an external wallet requires that wallet's signature. Step-up auth, if added, applies to all methods equally.
- Exactly two native Para projects exist historically (BETA aud `fc297713-…`, PROD aud `8c67b747-…` — confirm full values from deployment env). Backfill is deployment-aware; lazy-confirm on next login where ambiguous.
- **Port, don't rebase.** Both source branches are ~100+ commits stale.
- Known security holes to close in Phase 7 (pre-existing): account DELETE bypasses last-factor guards; no step-up auth anywhere; `unlinkWallet` exempts embedded wallets from last-factor checks.

---

## 3. Ownership map

| Area                                                                                                                                                                              | Source                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Public `AomiWidget` API, auth-config sugar, consumer example, CSS packaging                                                                                                       | Port from PR #339      |
| WST, observed-origin, SIWE challenge, public CORS, bearer injection, memory-only client lifecycle, principal resolution                                                           | Port from PR #355      |
| Provider SDK integration, credential extraction (`AuthRuntime.getCredential`), plugin registry, account/wallet UI, native verifier registry                                       | Already on main        |
| Provider descriptor contract, tenant-aware schema, atomic resolver, multi-tenant verification, generic exchange route, SIWE/SIWS link-at-login, generalized widget-session client | **New implementation** |

---

## Phase 0 — Para contract experiment — **PASSED 2026-07-22**

Confirmed "same person on two consumer sites → one account" **for Para**. The gate is cleared: Para's `subjectIsEnvironmentGlobal: true` is no longer conditional. Each future provider still needs its own equivalent experiment before its flag may be true.

- [x] Two Para projects, same environment (BETA); same real user through both; JWTs verified against pinned BETA JWKS.
- [x] `aud` differs, `sub` and `data.userId` identical; `data.wallets` project-specific; `connectedWallets` session-specific.
- [x] Repeat after explicit logout/relogin in both projects — sub stable (confirmed 2026-07-22).
- [x] Second real user: different `sub`; that user's `sub === data.userId` across both projects (confirmed 2026-07-22).
- [x] Guest/pregenerated-session JWTs: no collision with claimed global users (confirmed 2026-07-22).
- [x] Decision record: Para global-sub matching within one environment is ENABLED; never match BETA↔PROD.

Non-gating follow-ups (do alongside Phase 3, not blockers):

- [x] Para contract documentation review: official docs identify JWT `sub` as the user ID and `aud` as the app/API-key identifier. Para does not publish an explicit global-immutability guarantee; the completed two-project, logout/relogin, second-user, and guest empirical checks remain the enabling evidence.
- [x] Sanitized fixtures from both token shapes → `packages/account/test/` (never real JWTs) — required for the Phase 3 verifier tests regardless.

## Phase 1 — Tenant-aware provider identities (db-master + product-mono + packages/account)

Prerequisite for accepting arbitrary tenants from any provider. Exact credential becomes `(provider, issuer_environment, tenant_id, subject)`; person-resolution stays global per provider policy via Phase 2.

**db-master** — ADD one migration:

- [x] Add nullable `issuer_environment text`, `tenant_id text` to `auth_providers`; backfill; validate; then `NOT NULL` both.
- [x] Replace `auth_providers_subject_uidx` with `unique (provider, issuer_environment, tenant_id, subject) where subject is not null` after backfill validation.
- [x] Document the reversal of the "Subject stays globally UNIQUE" policy in the migration.
- [x] Backfill with an explicit audited deployment input (covers **all existing providers**, not just Para):
  - `para` → `('para:beta'|'para:prod', <native Para aud for that deployment>)`
  - `privy` → `('privy:<env>', <native Privy appId>)`
  - `betterauth` → `('aomi', 'portal')`
  - `siwe` → `('eip155', 'global')` · `siws` → `('solana', 'global')` · email-method rows → `('aomi', 'global')`
  - Record expected/actual row counts; multiple historical audiences → resolve per-row; never assign wildcard blind.

**product-mono** — MODIFY:

- [x] `aomi/crates/database/src/schema.rs` + `auth_provider` entity: mirror columns.
- [x] Replace `(provider, subject)`-unique lookup/conflict logic; add exact tenant-aware lookup and same-environment global-subject lookup that loads all rows and fails closed on multiple users (no `.first()` ambiguity). Verified by isolated Postgres migration replay plus Rust compile/clippy gates.

**aomi `packages/account`** — MODIFY:

- [x] `src/types.ts`: extend the `identity` arm of `SignalRef` (:157-169) and `DbAomiAuthIdentity` (:35-46) with `issuerEnvironment`, `tenantId`.
- [x] `src/db/queries.ts`: `upsertAuthIdentity` (:248) → 4-column conflict target, keep same-owner guard + throw; `findSignalOwner` (:185) → full-tuple identity lookup; ADD `findProviderSubjectOwners(provider, issuerEnvironment, subject)` (tenant-agnostic, returns ALL owners) for the resolver's global-sub signal; update row mappers in `revokeAuthIdentity` (:314), `listIdentitiesForUser` (:437), `findAuthIdentityById` (:507), `updateAuthIdentityLabel` (:518).
- [x] Call sites that build identity signals/upserts: `service/account-service.ts` (`linkProviderIdentity` :414, SIWE/SIWS subject builders :902/:915), `service/provider-exchange.ts`, `better-auth/provider-plugin.ts` (:97-104 accessSignals). Native path passes its own tenant (native aud/appId) — native is just tenant #1.
- [x] Update tests: `canonical-queries.test.ts`, `provider-exchange.test.ts`, `account-service-adoption.test.ts`.

**Gate**

- [x] Existing `users.id` values unchanged after backfill (migration test).
- [x] Two tenant credentials for one user store as two rows, one owner.

## Phase 2 — Atomic canonical-user resolver (net-new)

One reusable service for ALL verified provider logins (native and widget, any provider). Replaces first-match-wins.

- [x] ADD `packages/account/src/service/identity-resolution.ts`: `resolveVerifiedProviderIdentity({ identity: VerifiedProviderIdentity, policy, linkProof? })` — single DB transaction.
- [x] Gather ALL owners: exact tenant credential; **iff `policy.subjectIsEnvironmentGlobal`** the tenant-agnostic `findProviderSubjectOwners` set; verified Aomi recovery factors; optional Phase-8 `linkProof` wallet owner. Wallet claims per `policy.walletClaimTrust` only; never `connectedWallets`.
- [x] Concurrency safety: deterministic `pg_advisory_xact_lock` keys derived from the exact-credential tuple AND the `(provider, issuerEnvironment, subject)` global key; re-query after locking; retry recoverable uniqueness races. (Two tenants of one global subject arriving concurrently must yield one user.)
- [x] Dedupe owner set: 0 → create user; 1 → attach; >1 → `identity_conflict`, rollback, **write nothing**.
- [x] On success attach: exact tenant credential + safe metadata; email as display only; never move a wallet from a different owner.
- [x] REPLACE `findFirstSignalOwner()` (account-service.ts:192, sole caller :108 in `getOrCreateAomiUserForBetterAuthSession`): route that path through the resolver; DELETE the old function.
- [x] Tests (parameterized over a fake provider descriptor, not Para): no-owner creates; exact-tenant resolves; global-sub resolves same user when policy allows and NOT when policy forbids; concurrent first logins under two tenants create one user; identical signals → one owner; contradictory owners → zero writes; UUID stability.

## Phase 3 — Provider verifier layer (multi-tenant, registry-driven)

- [x] ADD `packages/account/src/providers/descriptor.ts`: `WidgetProviderDescriptor`, `VerifiedProviderIdentity`, registry (`registerWidgetProvider`/`getWidgetProvider`), export via `./providers`.
- [x] MODIFY `providers/para.ts`: ADD `paraWidgetDescriptor` — pinned JWKS registry `{ BETA: https://api.beta.getpara.com/.well-known/jwks.json, PROD: https://api.getpara.com/.well-known/jwks.json }`; validate environment ∈ {BETA, PROD}, signature, **pinned alg allowlist**, `kid`, `exp`, `iat`, skew, non-empty `sub`, non-empty well-formed `aud` (data → `tenantId`), wallet-claim shape; **real email verification semantics: absent flag ⇒ `verified: false`** (do not port the `Boolean(nestedEmail)` hack). Policy: `subjectIsEnvironmentGlobal: true` (Phase 0 passed), `walletClaimTrust: "none"` until the separate wallet-claim classification is done, `widgetEnabled: true`.
- [x] MODIFY `providers/privy.ts`: ADD `privyWidgetDescriptor` — tenant-scoped keys (per-appId verification key resolution), `subjectIsEnvironmentGlobal: false`, `widgetEnabled: false` (exchange returns `provider_not_enabled`). Registering it now proves the contract is generic.
- [x] MODIFY `types.ts:117-130` + `account-credentials.ts` `normalizeCredential` (:302): open the credential union (`{ provider: string; tokenKind?: string; providerToken: string; keyId?: string }`); per-descriptor normalization; native registry keeps working.
- [x] Native path keeps strict-audience verification for now (native aud/appId is tenant #1; converge later).
- [x] Disable REST wallet reconciliation for the widget path (`listParaWalletsForUser` / `PARA_API_SECRET_KEY`); verified-token claims are the only wallet source. Do not assume JWT `sub` maps to Para REST `CUSTOM_ID` (`default-wallet-attesters.ts:28` hardcode noted).
- [x] Tests — reject: bad environment, browser-supplied key material, bad signature, wrong alg/kid, expired, missing `exp`/`iat`/`aud`/`sub`, empty `aud`, malformed wallets. Accept: valid BETA + PROD tokens, arbitrary signed audiences, same subject under multiple audiences (Phase-0 fixtures). Registry: unknown provider rejected; `widgetEnabled: false` → `provider_not_enabled`.

## Phase 4 — Port the WST implementation (from #355)

Port nearly verbatim — it verified clean and is already provider-neutral at the principal level. ADD (target dirs pre-scaffolded, empty):

- [x] `packages/account/src/widget-auth/{origin.ts, session.ts, store.ts, siwe.ts, index.ts}` (+ `test/widget-auth.test.ts`).
- [x] `apps/portal/src/lib/widget-auth/{cors.ts, principal.ts, response.ts}`.
- [x] `packages/client/src/widget-session.ts` (+ unit test) — generalized in Phase 6.
- [x] `apps/portal/src/app/api/auth/widget/siwe/{nonce,verify}/route.ts`, `session/route.ts`; ADD SIWS parity `siws/{nonce,verify}/route.ts` (main already has SIWS verify machinery in `better-auth/siws.ts`).
- [x] **Port fix**: `principal.ts` import → `apps/portal/src/server/canonical-session.ts` (`resolveBetterAuthCanonicalUserId`).
- [x] Preserve exactly: `aomi_wst_` + 32 random bytes; SHA-256 identifier in `ba_verifications` (raw token never stored); 30-min TTL; memory-only browser storage; observed-origin binding; explicit revocation (`DELETE /api/auth/widget/session`); `credentials: "omit"`; refresh-before-expiry; single retry after 401; token never forwarded to Rust.
- [x] Extend the ticket (zod union in `store.ts`): `{ kind: "widget_session", sessionId, userId, origin, authMethod: "siwe" | "siws" | <providerId>, providerIdentityId?, issuedAt, expiresAt }` — `authMethod` is an open string, not a Para-shaped enum.
- [x] Principal union: `better_auth | widget | anonymous`; wire `resolvePortalPrincipal()` into `createBackendProxy({ resolveCanonicalUserId })` in `apps/portal/src/app/api/[...slug]/route.ts:123-138` (BetterAuth first, WST fallback). BFF uses only `principal.userId` to mint the ordinary AccountBearer.
- [x] Session resolution verifies the user is active. **Decision to lock here: unlinking a provider identity revokes WSTs minted through it (fail closed); account deletion/deactivation invalidates all WSTs.**
- [x] WST tests: origin-bound (A's token fails from B); hashed at rest; expiry; revocation; deactivated user rejected; invalid/expired bearer → 401 (not anonymous); missing origin fails; production HTTP fails; localhost HTTP ok in dev; Rust receives only AccountBearer.

## Phase 5 — Widget exchange route (generic, registry-driven)

- [x] ADD `apps/portal/src/app/api/auth/widget/exchange/route.ts` (dir pre-scaffolded): `POST` with body `{ provider: string, environment, provider_token, key_id? }`, validated by the union of registered descriptors' `credentialSchema`s.
- [x] Flow: observed HTTP `Origin` (reject missing/`null`/invalid production origins) → body → `getWidgetProvider(provider)` (unknown → 400; `widgetEnabled: false` → `provider_not_enabled`) → `verifyWidgetCredential` → `VerifiedProviderIdentity` → Phase-2 resolver with the descriptor's policy → `issueWidgetSession` (origin-bound) → `{ access_token, token_type: "Bearer", expires_at, user: { id } }`.
- [x] Default v1 resolution: 0 → create; 1 → use; >1 → hard `identity_conflict`, zero writes. Not `account_link_needed`.
- [x] Already-authenticated linking uses the Phase-7 `/v1/account/provider/exchange` route (current principal + verified credential). Phase-8 pre-creation linking, if shipped, uses an explicit resolve-without-create pending-exchange ID.
- [x] Must NOT: create a BetterAuth cookie; require a BetterAuth user; compare tenant to Aomi's native key; store/log/forward the raw provider token; accept browser-supplied user id or key material; require an Aomi widget key.
- [x] Shared first-party logic: native provider login → same verify + resolver → BetterAuth session; widget → same verify + resolver → WST. WST never depends on BetterAuth.
- [x] Follow-up noted (not v1): `device-auth` routes' literal `"privy" | "para"` guards (`grant`, `link-intent`, `link-grant`, `exchange`) move to registry validation.

## Phase 6 — Frontend: #339's face on the generalized transport

Port from #339 (net-new only):

- [x] ADD `apps/shadcn-registry/src/components/aomi-widget.tsx` (`AomiWidget`, `AomiWidgetProps` with `auth?: AomiWidgetAuthConfig`) — its `resolveWidgetAuth` sugar already routes through the plugin registry.
- [x] ADD `providers/para/widget-auth.ts` (`paraAuth()`) and `providers/privy/widget-auth.ts` (`privyAuth()` → `provider_not_enabled` for widget use), both as sugar over a shared generic `providerAuth(id, opts)` in the wallet-kit config layer.
- [x] ADD `apps/widget-consumer/` Vite example (+ separate-origin variant to exercise CORS for real).
- [x] Packaging: re-evaluate #339's `tsup`/package-dist against main's actual `build-registry.js` setup; per-provider export subpaths already exist (one line per new provider).

Transport (generalize #355's client):

- [x] MODIFY `packages/client/src/widget-session.ts` (ported in Phase 4): split `createWidgetSessionProvider` into the adapter core + adapters: `SiweWidgetAuthAdapter`, `SiwsWidgetAuthAdapter`, and ONE `ProviderCredentialAdapter` that wraps any `AuthRuntime.getCredential` and posts to the Phase-5 exchange. Keep: memory-only cache keyed by `getFingerprint()`, refresh-before-expiry, concurrent-call dedupe, revoke on sign-out, `credentials: "omit"`.
- [x] The provider returns a `GetAccountBearer`-compatible callable → plugs into `clientOptions.getAccountBearer` → `wrapFetchWithAccountBearer` carries the WST on REST + SSE with zero runtime changes (mirror the existing pattern in `apps/portal/src/components/shell/portal-aomi-frame.tsx:94-98` / `apps/portal/src/lib/account-bearer.ts:29-54`).
- [x] MODIFY `src/lib/wallet-kit/account/aomi-backend-client.ts`: `fetchJson` (:188-207) gains an auth mode — `{ credentials: "include" }` (native, default) vs `{ credentials: "omit", getAuthorization }` (widget). Thread through `createAomiBackendAccountClient` options and `account/aomi-backend-runtime.ts:35`.
- [x] MODIFY `src/lib/wallet-kit/types.ts:274-285`: open `AomiAccountCredential`; converge with `packages/client/src/account-session.ts:3-8`.
- [x] Mode selection: `auth={paraAuth(...)}` → provider→WST; auth omitted + external wallet → SIWE/SIWS→WST; configured-auth failure never silently falls back to anonymous.
- [x] Frontend tests: login obtains WST; REST/polling/SSE carry it; `credentials` is `omit`; one refresh on 401; concurrent calls share one exchange; sign-out revokes; provider logout works; no silent anonymous fallback; a **fake provider plugin** exercises the adapter without Para/Privy SDKs.
- [x] Packaging tests: provider subpath isolation (para build excludes privy and vice versa; providerless build excludes both); CSS in the Vite consumer; registry artifacts match source exports.

## Phase 7 — Account routes on generic principals (+ close known holes)

- [x] MODIFY to `resolvePortalPrincipal()` (from BetterAuth-only `requireAomiSession`): `api/aomi/account/route.ts`, `account-bearer/route.ts`, `sign-out/route.ts`, `provider/exchange/route.ts`, `wallets/link/route.ts`, `wallets/[id]/route.ts`, `identities/[id]/route.ts`. `device-auth/*` stays BetterAuth-only.
- [x] Same `users.id`, payloads, ownership rules, conflict logic, permissions for both principals. No consumer permission model.
- [x] Replace the BetterAuth-only account response session shape with an explicit carrier union (`better_auth | widget`) — no fake `betterAuthUserId` for WST principals; update account/client/widget types together.
- [x] Distinguish missing credentials from explicit invalid/expired WST: invalid bearer → `401` even on optional routes (client refreshes once); never silent anonymous.
- [x] Sign-out: BetterAuth → clear session; WST → revoke token only (never unlink the provider identity or delete wallets; client may also log the provider out).
- [x] Close pre-existing holes: account DELETE respects last-factor guards (`countLoginFactors`, `queries.ts:232`); `unlinkWallet` (`account-service.ts:770`) stops exempting embedded wallets from last-factor. (Step-up for deletion is a later, equal-for-all addition.)

## Phase 8 — SIWE/SIWS as a linking mechanism (link-at-first-login)

Optional and intentionally not shipped in v1. The shipped SIWE/SIWS path supports direct wallet authentication; pre-creation provider-account linking remains a future enhancement. Its retained design is: pending-exchange ID on explicit resolve-without-create; dedicated link challenge binding `intent, origin, environment, tenant, subject, pending-exchange ID, iat, exp`; proof feeds the resolver as `linkProof`; wallets never move; conflicting proof → `identity_conflict`, zero writes; EOA SIWE + SIWS in scope, ERC-1271 out; UX pass for the interstitial; replay tests.

## Phase 9 — CORS policies

- [x] Two policies: existing BetterAuth routes retain their configured `trustedOrigins` credential policy; public widget routes reflect a validated HTTPS origin, omit `Allow-Credentials`, allow `Authorization`, and set `Vary: Origin` for `/api/auth/widget/*`, `/v1/account/*`, and supported BFF routes.
- [x] On public widget origins, reject ambient BetterAuth-cookie auth; require WST bearer for protected behavior. Omitting `Allow-Credentials` alone is not an authorization check.
- [x] Origin is session binding, not consumer authentication. No origin-registration/allowlist for v1.

---

## Multi-consumer behavior (acceptance cases)

- [x] **A — same provider subject, two consumers** (policy-on provider): two tenant credentials, one `users.id`, no prompt. (Para: unblocked — Phase 0 passed.)
- [x] **B — different subjects, same wallet**: no automatic match from token wallet arrays; optional Phase-8 wallet proof may link; wallets never move.
- [x] **C — same email only**: no auto-merge; fresh user by default.
- [x] **D — contradictory owners**: `identity_conflict`, zero writes.
- [x] **E — policy-off provider (Privy-shaped), same human on two consumers**: two separate accounts by design; Phase-8 wallet proof is the opt-in bridge.

## Definition of done

- [ ] An unrelated HTTPS consumer can: install the package, configure its own provider key, mount `AomiWidget`, log in, receive an origin-bound WST, create/access threads, stream chat, use normal account routes, sign transactions locally via the provider, sign out with WST revocation. (Package mounting, CSS, failure fallback, CORS, OAuth redirect, and WST revocation are verified locally. The user-controlled Para wallet selection and subsequent live login/thread/signing checks remain.)
- [x] Consumer A + Consumer B resolve the same policy-on provider user to one `users.id`, both credentials recorded.
- [x] Adding a hypothetical third provider touches ONLY: one backend descriptor module + registration, one frontend plugin + `providerAuth` sugar + one export subpath. Zero edits in resolver, exchange route, WST, principal, account routes, or client transport. (Assert with the fake-provider tests.)
- [x] Same permissions native and embedded; no Aomi key, no provider secret, no third-party cookie; no provider token or WST reaches Rust; existing user UUIDs preserved.

### Completion verification — 2026-07-22

- Isolated Postgres replay validated the tenant-scope migration's successful backfill, duplicate-subject/different-tenant storage, unresolved-provider abort, rollback, and unchanged user ownership.
- `aomi`: ESLint; account and portal typechecks; library, client, registry, declaration, consumer, and dry-run package builds; 769 root tests (28 repository-configured integration skips), 252 widget-library tests, and the portal test command all passed.
- `product-mono/aomi`: `cargo fmt --all --check` and `cargo clippy -p aomi-database -- -D warnings` passed.
- Package versions were patch-bumped to `@aomi-labs/account@0.1.4`, `@aomi-labs/client@0.3.7`, and `@aomi-labs/widget-lib@1.4.9`; generated publishable artifacts and `pnpm-lock.yaml` were refreshed.
- Portal retains its existing local Para project. Landing and the ignored standalone consumer `.env.local` use the requested separate BETA browser key; the consumer also pins `VITE_PARA_ENVIRONMENT=BETA`. No local env file is tracked.
- Live browser follow-up verified that Portal runs on `3000` and the standalone consumer runs on `3001`. The consumer renders its complete widget shell and a visible Retry/allowed-origin diagnostic when Para startup fails instead of leaving a blank page. After authorizing the consumer origin, removing the fixture's `disableWorkers` override restored Para's OAuth encryption-worker path: the Google popup now leaves `about:blank` and reaches Para's wallet-selection screen. The remaining unchecked work starts with the user-controlled wallet selection.

## Non-goals (unchanged)

Privy external-consumer _enablement_ (the descriptor ships disabled); provider REST reconciliation; provider secret storage; partner dashboards; consumer-specific roles/permissions; origin allowlisting; billing/analytics per integration; **mandatory** SIWE/SIWS after provider login; smart-account SIWE; full account-merge tooling; automatic email-only merging.

## Working agreements for the implementing agent

1. Start from this branch (already == `main`). Port selectively from `2487a5b9` (#339) and `a586b016` (#355); never cherry-pick whole commits.
2. Phase 1 lands before arbitrary tenants are accepted anywhere.
3. Identity resolution is one transaction; never first-match-wins; never trust consumer-supplied keys; never use token email as ownership; never forward WST/provider tokens to Rust.
4. **No provider names in shared code.** Any `if (provider === "para")` outside `providers/para*` / the para plugin dir is a review-blocking defect. Shared code consumes `VerifiedProviderIdentity` + `policy` only.
5. Keep each phase a narrow, independently testable PR. Close #339 and #355 as superseded once replacements merge.
6. Patch-bump every changed publishable package (`@aomi-labs/account`, `@aomi-labs/client`, `@aomi-labs/widget-lib` as applicable), refresh generated artifacts, verify packed npm contents in the same change.
