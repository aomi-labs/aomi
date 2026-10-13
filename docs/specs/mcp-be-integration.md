# MCP BE Integration — coherent plan

> **Status (2026-05-31): BE side fully implemented.** The phases below are
> all shipped in `product-mono`: `POST /api/_internal/approvals`
> (`bin/backend/src/endpoint/admin_scope/internal_approvals.rs`),
> `SecretVault::ingest_identity` + `identity_records` (`crates/tools/src/vault.rs`),
> and the Privy wallet provider + agent tools
> (`crates/tools/src/authorized_signer/privy.rs`,
> `crates/tools/src/authorized_signing/{authorized_sign,get_wallet_provider_info}.rs`).
> The portal/`@aomi-labs/auth` side calls these via `BeApprovalsStore`. Read
> this doc for the design rationale; the §0 table and §3 checkboxes below
> reflect the original planning snapshot, not current state.

Takes ownership of the BE-side work to make the MCP→Aomi loop genuinely
useful (Claude → Aomi → on-chain tx via Privy). Lays out the integration
between portal (TS) and BE (Rust) end-to-end, grounded in the real
entities (`DbUser`, `DbAuthIdentity`, `DbAccessApproval`, `DbPendingAuth`,
`SecretVault`).

## 0. Where we are (original planning snapshot — now superseded)

| Layer | State |
| --- | --- |
| Portal MCP tools (`connect_app`, `disconnect_app`, `chat`, `pending_tx`) | shipped |
| Portal OAuth (`dummy`, `privy`) → callback → BE secret ingest | works |
| BE `/api/_internal/secrets` (X-Aomi-Auth guarded, SecretVault per `(user_id, app)`) | works |
| BE `AccessClient` (Path 2 outbound, `CanonicalUserId` extractor) | shipped |
| BE Diesel entities (`auth_identities`, `access_approvals`, `pending_auths`) | now wired via `internal_approvals.rs` |
| Portal `access_approval` / `pending_auths` | in-memory, lost on HMR |
| Agent tool reading PRIVY_*, signing via Privy | shipped (`authorized_signer/privy.rs`) |

## 1. The data model the agent must respect

Corrected from the earlier "user has Privy somewhere" model:

```
DbUser
  └── DbAuthIdentity         (per: application × wallet_provider × subject)
        └── DbAccessApproval (one active row per identity, carries secret_handle)
              └── SecretVault slot(s)  (keyed by auth_identity_id, post-refactor)
```

Two parallel identities for the same Aomi user (Alice on Byreal via Privy
*and* Alice on Byreal via Para) → two `DbAuthIdentity` rows, two
`DbAccessApproval` rows, two distinct secret-slot collections.

The agent always knows its `(user_id, application)` from chat context
(`chat_endpoint` has `app_key: Option<Extension<AomiAppKey>>`). When it
needs a wallet operation, it queries identities for that pair and picks
one (primary-first, or matches `preferred_provider`).

## 2. Coherent integration

### 2.1 SecretVault — add identity-keyed records

Today's keys: `client_records` (BYOK), `app_records` (`(client_id, app)`).
Add a third map keyed by `auth_identity_id`:

```rust
// crates/tools/src/vault.rs
pub struct SecretVault {
    client_records: DashMap<String, HashMap<String, String>>,
    app_records:    DashMap<String, HashMap<String, HashMap<String, String>>>,
    /// NEW: auth_identity_id → (slot_name → raw_value)
    identity_records: DashMap<i64, HashMap<String, String>>,
    session_to_client: DashMap<String, String>,
    mutation_listener: OnceLock<MutationListener>,
}

impl SecretVault {
    /// Stash secrets keyed by auth_identity_id. Returns name→handle map.
    pub fn ingest_identity(
        &self,
        auth_identity_id: i64,
        secrets: HashMap<String, String>,
    ) -> HashMap<String, String> { /* ... */ }

    /// Resolve a single slot for an identity.
    pub fn get_identity_secret(
        &self,
        auth_identity_id: i64,
        slot_name: &str,
    ) -> Option<String> { /* ... */ }

    /// List slot names currently filled for an identity (no values).
    pub fn list_identity_handles(&self, auth_identity_id: i64) -> Vec<String> { /* ... */ }

    /// Drop everything for an identity (called on revoke).
    pub fn clear_identity(&self, auth_identity_id: i64) -> bool { /* ... */ }
}
```

Existing `app_records` and `client_records` keep working — BYOK / PAYMENT
paths don't change. Only the new wallet-provider auth path uses
`identity_records`.

### 2.2 New endpoint — atomic approval completion

Replace today's two-step (portal does its own bookkeeping + calls
`_internal/secrets`) with one atomic BE endpoint that does all the
identity/approval/secret writes in one call:

```
POST /api/_internal/approvals
X-Aomi-Auth: <token>
Content-Type: application/json

{
  "user_id":               "alice",
  "application":           "byreal" | null,          // null = global Aomi identity
  "wallet_provider":       "privy",
  "wallet_provider_subject": "did:privy:abc",       // nullable for non-wallet identities
  "auth_method":           "email",                  // 'email' | 'phone' | 'x' | 'google' | ...
  "auth_value":            "alice@example.com",
  "is_primary":            false,
  "identity_metadata":     { ... },
  "grant_kind":            "oauth",                  // 'oauth' | 'api_key' | 'delegated_signer'
  "scopes":                ["spot:read"],
  "secrets":               { "PRIVY_ACCESS_TOKEN": "...", ... },
  "expires_at":            1779540000,               // optional
  "approval_metadata":     { ... }
}

→ 200 { "auth_identity_id": 42, "approval_id": 17 }
```

Handler responsibility (single DB transaction where possible):

1. `DbUser::ensure(user_id)` — upsert (create the user row if it's the
   first MCP call we've ever seen for this id).
2. `DbAuthIdentity::ensure(user_id, application, wallet_provider, subject,
   auth_method, auth_value, ...)` — already exists, returns identity row.
3. `SecretVault::ingest_identity(identity.id, secrets)` — stash creds.
4. Build `secret_handle` string referring to the identity (just `id:42` —
   it's an opaque pointer; no need to bake slot names into it because the
   provider's `WalletSlots` declares them).
5. `DbAccessApproval::insert(user_id, identity.id, application, grant_kind,
   secret_handle, ...)`.
6. Return `{auth_identity_id, approval_id}`.

This endpoint is `X-Aomi-Auth` guarded the same way `_internal/secrets` is.

### 2.3 WalletProvider trait + registry

```rust
// crates/tools/src/wallet/mod.rs
pub trait WalletProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn slots(&self) -> WalletSlots;
    async fn get_address(&self, secrets: &ResolvedSecrets) -> Result<String>;
    async fn sign(
        &self,
        secrets: &ResolvedSecrets,
        request: UnsignedTx,
    ) -> Result<TxResult>;
}

pub struct WalletSlots {
    pub address:      &'static str,
    pub access_token: Option<&'static str>,
    pub wallet_id:    Option<&'static str>,
    pub user_id:      Option<&'static str>,
}

pub fn wallet_registry() -> &'static HashMap<&'static str, Arc<dyn WalletProvider>> {
    static REGISTRY: OnceLock<HashMap<&'static str, Arc<dyn WalletProvider>>> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let mut m = HashMap::new();
        m.insert("privy", Arc::new(PrivyWalletProvider::new()) as _);
        // m.insert("para", Arc::new(ParaWalletProvider::new()) as _);
        m
    })
}
```

`PrivyWalletProvider`:

```rust
// crates/tools/src/wallet/privy.rs
impl WalletProvider for PrivyWalletProvider {
    fn name(&self) -> &'static str { "privy" }
    fn slots(&self) -> WalletSlots {
        WalletSlots {
            address:      "PRIVY_WALLET_ADDRESS",
            access_token: Some("PRIVY_ACCESS_TOKEN"),
            wallet_id:    Some("PRIVY_WALLET_ID"),
            user_id:      Some("PRIVY_USER_ID"),
        }
    }
    async fn get_address(&self, secrets: &ResolvedSecrets) -> Result<String> {
        secrets.required(self.slots().address)
    }
    async fn sign(&self, secrets: &ResolvedSecrets, tx: UnsignedTx) -> Result<TxResult> {
        let access  = secrets.required(self.slots().access_token.unwrap())?;
        let wallet  = secrets.required(self.slots().wallet_id.unwrap())?;
        // POST https://api.privy.io/v1/wallets/{wallet}/rpc
        // body: { method: "eth_sendTransaction", params: [tx], chain_id }
        // auth: Bearer {access}
        ...
    }
}
```

Slot literals only appear inside the impl. The tool layer never types
"PRIVY_*" anywhere.

### 2.4 Agent tools

```rust
// crates/tools/src/wallet/agent_tools.rs

/// get_wallet_info — what wallet address is connected for this user
///                    in this app context?
async fn get_wallet_info(
    pool: &DbPool,
    user_id: &str,
    application: Option<&str>,        // from chat_endpoint app context
    preferred_provider: Option<&str>, // optional
) -> Result<WalletInfo> {
    let candidates = pick_candidate_identities(pool, user_id, application, preferred_provider).await?;
    for identity in candidates {
        let Some(approval) = DbAccessApproval::active_for_identity_app(pool, identity.id, application.unwrap_or("")).await?.into_iter().next() else { continue };
        let provider = wallet_registry().get(identity.wallet_provider.as_str()).context("unknown provider")?;
        let vault = SecretVault::get_or_init().await;
        let secrets = ResolvedSecrets::from_identity(&vault, identity.id, provider.slots());
        let address = provider.get_address(&secrets).await?;
        return Ok(WalletInfo {
            wallet_provider: identity.wallet_provider,
            address,
            auth_identity_id: identity.id,
            approval_id: approval.id,
        });
    }
    bail!("no active wallet approval for user {user_id} in app {application:?}");
}

/// sign_tx — same lookup, then dispatch to provider's sign().
```

These are registered as Aomi tools (alongside `binance_get_price` etc.) so
the agent calls them when it needs wallet capability.

### 2.5 Portal callback rewrites

Former path `apps/portal/src/lib/aomi-auth/secret-store/be-vault.ts` was to be
replaced by a new module that calls the atomic endpoint. The auth `callback.ts`
route handler collects everything the BE needs from the provider response and
sends one POST.

```ts
// packages/auth/src/secret-store/be-approvals.ts
export class BeApprovalsStore {
  async completeApproval(args: {
    userId: string;
    application: string | null;            // 'byreal' | null
    walletProvider: string;                // 'privy'
    walletProviderSubject: string | null;  // 'did:privy:abc'
    authMethod: string;                    // 'email'
    authValue: string;                     // 'alice@x.com'
    isPrimary: boolean;
    grantKind: string;                     // 'oauth'
    scopes: string[];
    secrets: Record<string, string>;
    expiresAt?: number;
    metadata?: Record<string, unknown>;
  }): Promise<{ authIdentityId: number; approvalId: number }> {
    // POST /api/_internal/approvals
  }
}
```

The provider's `callback()` response shape grows from `{secrets,
displayLabel, body}` to also include the identity fields:

```ts
// packages/auth/src/providers/types.ts
export interface ProviderCallbackResponse {
  secrets: Record<string, string>;
  displayLabel: string;
  body?: string;
  // NEW — identity metadata the BE needs to upsert DbAuthIdentity:
  identity: {
    walletProvider: string;       // 'privy'
    walletProviderSubject: string | null;
    authMethod: string;           // 'email' | 'phone' | ...
    authValue: string;
    isPrimary?: boolean;
    metadata?: Record<string, unknown>;
  };
  grantKind: string;              // 'oauth' | 'api_key' | ...
  scopes?: string[];
  expiresAt?: number;
}
```

The Privy provider sets identity fields from the JWT (`sub` → subject,
linked accounts → auth_method/value). The dummy provider fills synthetic
ones for testing.

### 2.6 Portal access_approval — switch to "BE is source of truth"

Today portal has its own in-memory `access_approval`. After this change:

- Portal still owns `pending_auths` (short-lived, in-memory is OK)
- Portal stops tracking `access_approval` locally; instead asks BE
- New BE endpoint: `GET /api/_internal/approvals?user_id=X&application=Y`
  → returns rows the portal's `lookupApproval` needs
- OR: portal calls a BE endpoint that mirrors `lookupApproval` semantics
  directly: `GET /api/_internal/approvals/active?user_id=X&application=Y`

This lands once 2.1–2.5 are working — defer to phase 2.

## 3. Phasing

**Phase 1 — BE foundation (this turn + next)**

- [ ] §2.1 SecretVault: `identity_records` + 4 methods + tests
- [ ] §2.2 New `POST /api/_internal/approvals` endpoint + route mount
- [ ] cargo check + unit tests pass

**Phase 2 — BE wallet provider abstraction**

- [ ] §2.3 `WalletProvider` trait + registry + `ResolvedSecrets` helper
- [ ] `PrivyWalletProvider` impl (slots + signing via `api.privy.io/v1/wallets/{id}/rpc`)
- [ ] Privy HTTP error handling (401 → mark approval for refresh)

**Phase 3 — BE agent tools**

- [ ] `get_wallet_info` Aomi tool
- [ ] `sign_tx` integration with existing tx-staging path
- [ ] Wire into the agent's tool set

**Phase 4 — Portal cutover**

- [ ] §2.5 `BeApprovalsStore` (new), retire `BeVaultSecretStore`
- [ ] Update `ProviderCallbackResponse` shape
- [ ] Update Privy + dummy providers to emit identity fields
- [ ] Callback route uses the new store

**Phase 5 — Portal reads approvals from BE**

- [ ] §2.6 BE adds `_internal/approvals` GET endpoint
- [ ] Portal `Store.getActiveApproval` calls BE instead of in-memory
- [ ] Portal in-memory `access_approval` map removed

## 4. Open questions before committing the design

1. **`application` mapping.** Portal currently uses `provider` as the
   `app` key in SecretVault calls (`"privy"`, `"dummy"`). The corrected
   model wants `application` to be the Aomi-app name (`"byreal"`,
   `"default"`, etc.) and `wallet_provider` to be `"privy"`. The
   atomic endpoint accepts both as distinct fields, so this resolves
   cleanly — but the portal callback needs to know the Aomi app
   context. For MCP that's straightforward (Claude is calling
   `connect_app` from within an Aomi-app session); for the dummy test
   path we just pass `application = null` (global Aomi identity).

2. **`identity_records` keying when DB id isn't yet assigned.** The
   atomic endpoint hands the identity to SecretVault *after* the DB
   insert returns the id. No race.

3. **`pending_auths` lives only in portal memory. The BE DB entity has
   been deleted** (was unused, was speculative). Pending OAuth state has
   a short lifetime (auth-flow window only) and isn't worth multi-
   instance durability today. If MCP serverless ever forces it, add a
   fresh migration + `_internal/pending_auths` endpoints later.

4. **Compatibility with current portal demo.** The phase-1 BE work
   leaves the existing `_internal/secrets` endpoint untouched. The
   portal keeps working unchanged. Only when phase-4 lands does the
   portal cut over to the new endpoint. Until then, both paths coexist.

## 5. MCP tool surface (post-rename)

The portal connect/disconnect tools split along the `(application,
wallet_provider)` shape:

| Tool | application | wallet_provider |
| --- | --- | --- |
| `connect_provider(provider)` | NULL (global) | from args |
| `connect_app(application, provider)` | from args | from args |
| `disconnect_provider(provider)` | NULL (global) | from args |
| `disconnect_app(application, provider)` | from args | from args |

Plus `chat` and `pending_tx`. Six tools total. The split mirrors
`DbAuthIdentity` directly — `connect_provider` is sugar for
`connect_app(NULL, ...)` and the LLM picks based on whether the user's
intent is global ("connect Privy to my Aomi account") or app-scoped
("connect Privy for Byreal").
