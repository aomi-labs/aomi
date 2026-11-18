-- Prerequisites for the current account-merge routines, applied after
-- tests/e2e/fixtures/canonical-account-schema.sql. Wallet ownership
-- constraints are from 20260825010000_public_key_swig_bindings.sql.

ALTER TABLE public_keys
    ADD CONSTRAINT public_keys_id_user_id_key UNIQUE (id, user_id),
    ADD CONSTRAINT public_keys_id_user_provider_key
        UNIQUE (id, user_id, auth_provider_id);

CREATE TABLE signing_delegations (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    auth_provider_id BIGINT NOT NULL,
    public_key_id BIGINT NOT NULL,
    provider TEXT NOT NULL CHECK (btrim(provider) <> ''),
    kind TEXT NOT NULL CHECK (btrim(kind) <> ''),
    secret_handle TEXT NOT NULL CHECK (btrim(secret_handle) <> ''),
    -- Private provider material. Never project this into public DTOs or logs.
    private_metadata JSONB NOT NULL DEFAULT '{}'::JSONB
        CHECK (jsonb_typeof(private_metadata) = 'object'),
    expires_at BIGINT,
    revoked_at BIGINT,
    revocation_reason TEXT,
    created_at BIGINT NOT NULL DEFAULT extract(epoch FROM now())::BIGINT,
    updated_at BIGINT NOT NULL DEFAULT extract(epoch FROM now())::BIGINT,
    CONSTRAINT signing_delegations_provider_same_user_fk
        FOREIGN KEY (auth_provider_id, user_id)
        REFERENCES auth_providers(id, user_id),
    CONSTRAINT signing_delegations_key_same_user_fk
        FOREIGN KEY (public_key_id, user_id, auth_provider_id)
        REFERENCES public_keys(id, user_id, auth_provider_id) ON UPDATE CASCADE,
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX signing_delegations_active_key_provider_uidx
    ON signing_delegations(public_key_id, provider)
    WHERE revoked_at IS NULL;
CREATE INDEX signing_delegations_user_history_idx
    ON signing_delegations(user_id, created_at DESC, id DESC);

CREATE TABLE operating_accounts (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_public_key_id BIGINT NOT NULL,
    chain_family TEXT NOT NULL CHECK (chain_family IN ('evm', 'svm')),
    -- Decimal EVM chain id or canonical SVM cluster.
    chain_ref TEXT NOT NULL CHECK (btrim(chain_ref) <> ''),
    operating_address TEXT NOT NULL CHECK (btrim(operating_address) <> ''),
    provider TEXT NOT NULL CHECK (btrim(provider) <> ''),
    kind TEXT NOT NULL CHECK (btrim(kind) <> ''),
    status TEXT NOT NULL CHECK (status IN ('provisioning', 'active', 'unavailable')),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at BIGINT NOT NULL DEFAULT extract(epoch FROM now())::BIGINT,
    updated_at BIGINT NOT NULL DEFAULT extract(epoch FROM now())::BIGINT,
    CONSTRAINT operating_accounts_owner_same_user_fk
        FOREIGN KEY (owner_public_key_id, user_id)
        REFERENCES public_keys(id, user_id),
    CONSTRAINT operating_accounts_id_user_id_key UNIQUE (id, user_id),
    CONSTRAINT operating_accounts_owner_provider_kind_key
        UNIQUE (owner_public_key_id, chain_family, chain_ref, provider, kind),
    CONSTRAINT operating_accounts_address_key
        UNIQUE (chain_family, chain_ref, operating_address)
);

CREATE INDEX operating_accounts_user_history_idx
    ON operating_accounts(user_id, created_at DESC, id DESC);

CREATE TABLE onchain_policy_bindings (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_public_key_id BIGINT NOT NULL,
    delegated_public_key_id BIGINT NOT NULL,
    operating_account_id BIGINT NOT NULL,
    provider TEXT NOT NULL CHECK (btrim(provider) <> ''),
    policy_spec JSONB NOT NULL CHECK (jsonb_typeof(policy_spec) = 'object'),
    policy_hash BYTEA NOT NULL CHECK (octet_length(policy_hash) = 32),
    provider_binding JSONB NOT NULL CHECK (jsonb_typeof(provider_binding) = 'object'),
    status TEXT NOT NULL CHECK (status IN ('provisioning', 'active', 'revoked', 'unavailable')),
    confirmed_at BIGINT,
    revoked_at BIGINT,
    created_at BIGINT NOT NULL DEFAULT extract(epoch FROM now())::BIGINT,
    updated_at BIGINT NOT NULL DEFAULT extract(epoch FROM now())::BIGINT,
    CONSTRAINT onchain_policy_bindings_owner_same_user_fk
        FOREIGN KEY (owner_public_key_id, user_id)
        REFERENCES public_keys(id, user_id),
    CONSTRAINT onchain_policy_bindings_delegate_same_user_fk
        FOREIGN KEY (delegated_public_key_id, user_id)
        REFERENCES public_keys(id, user_id),
    CONSTRAINT onchain_policy_bindings_account_same_user_fk
        FOREIGN KEY (operating_account_id, user_id)
        REFERENCES operating_accounts(id, user_id),
    CHECK (owner_public_key_id <> delegated_public_key_id),
    CHECK (revoked_at IS NULL OR confirmed_at IS NOT NULL),
    CHECK (status <> 'active' OR confirmed_at IS NOT NULL),
    CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);

CREATE UNIQUE INDEX onchain_policy_bindings_active_delegate_provider_uidx
    ON onchain_policy_bindings(delegated_public_key_id, provider)
    WHERE status = 'active';
CREATE INDEX onchain_policy_bindings_user_history_idx
    ON onchain_policy_bindings(user_id, created_at DESC, id DESC);

create table funding_event (
  owner_kind text not null default 'account' check (owner_kind in ('account', 'builder')),
  owner_id text not null
);

create table credit_ledger (
  id bigserial primary key,
  owner_kind text not null default 'account' check (owner_kind in ('account', 'builder')),
  owner_id text not null,
  amount_microusd bigint not null,
  entry_kind text not null,
  payment_method text,
  payment_provider text,
  external_payment_reference text,
  idempotency_key text,
  created_at bigint not null
);
create unique index credit_ledger_owner_idempotency
  on credit_ledger (owner_kind, owner_id, idempotency_key) where idempotency_key is not null;

create table account_payment_locks (
  account_id text primary key references users(id),
  expires_at bigint not null
);

create table packages (
  id bigint generated by default as identity primary key,
  publisher text not null,
  name text not null,
  display_name text not null,
  unique (publisher, name)
);

create table user_package_secrets (
  id bigint generated always as identity primary key,
  user_id text not null references users(id) on delete cascade,
  package_id bigint not null references packages(id) on delete cascade,
  slot text not null,
  value_ciphertext text not null,
  created_at bigint not null,
  updated_at bigint not null,
  unique (user_id, package_id, slot)
);

create table user_packages (
  user_id text not null references users(id) on delete cascade,
  package_id bigint not null references packages(id) on delete cascade,
  enabled boolean not null default true,
  created_at bigint not null default extract(epoch from now())::bigint,
  updated_at bigint not null default extract(epoch from now())::bigint,
  primary key (user_id, package_id)
);

create table package_grants (
  id bigint generated always as identity primary key,
  package_id bigint not null references packages(id) on delete cascade,
  account_id text references users(id) on delete cascade,
  agent_id bigint references agents(id) on delete cascade,
  code_hash text not null,
  created_by bigint not null,
  created_at bigint not null default extract(epoch from now())::bigint,
  revoked_at bigint,
  check (num_nonnulls(account_id, agent_id) = 1)
);
create unique index package_grants_account_active_key on package_grants (package_id, account_id)
  where revoked_at is null and account_id is not null;
create unique index package_grants_agent_active_key on package_grants (package_id, agent_id)
  where revoked_at is null and agent_id is not null;

create table agent_usage_daily (
  user_id text not null references users(id) on delete cascade,
  agent_id bigint not null references agents(id) on delete restrict,
  period_utc_day text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  credits_used double precision not null default 0,
  updated_at bigint not null default extract(epoch from now())::bigint,
  primary key (period_utc_day, user_id, agent_id)
);

create table payment_runs (
  principal_kind text,
  principal_id text,
  state text,
  reserved_microusd bigint not null default 0,
  expires_at bigint
);
create table x402_attempts (principal_kind text, principal_id text);
create table llm_usage_events (subject_kind text, subject_id text);
create table thread_agent_requests (owner_subject text);
create table thread_agent_events (action_owner_subject text);

-- Commit Service rows: the columns read by account_merge_commits.
create table commits (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id),
  state text not null,
  commit_request jsonb,
  signed_blob jsonb,
  provider_operation_id text,
  failure_code text,
  version bigint not null default 1,
  updated_at bigint not null default 0
);

-- Merge ticket and ownership constraints from 20261007000000_account_merge.sql.
-- `status` is free text ('active', 'deactivated'); 'merged' joins them.
ALTER TABLE users ADD COLUMN merged_into TEXT REFERENCES users(id);
ALTER TABLE users ADD CONSTRAINT users_merged_into_ck
    CHECK ((status = 'merged') = (merged_into IS NOT NULL));

-- A merge offer. Minted when a link proves a credential that another account
-- owns; single use, short-lived, and bound to both accounts and the credential.
-- `id` is the sha256 of the ticket handed to the browser.
CREATE TABLE account_merge_tickets (
    id             TEXT PRIMARY KEY,
    target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential     JSONB NOT NULL,
    created_at     BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
    expires_at     BIGINT NOT NULL,
    consumed_at    BIGINT,
    CHECK (target_user_id <> source_user_id),
    CHECK (expires_at > created_at)
);
CREATE INDEX account_merge_tickets_target_idx ON account_merge_tickets(target_user_id);
ALTER TABLE account_merge_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_merge_tickets FROM PUBLIC;

-- These foreign keys pair a row with its owner. Re-keying the owner moves both
-- sides, so the merge defers them to the end of its own work.
ALTER TABLE public_keys ALTER CONSTRAINT public_keys_auth_provider_same_user_fk DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE operating_accounts ALTER CONSTRAINT operating_accounts_owner_same_user_fk DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE onchain_policy_bindings ALTER CONSTRAINT onchain_policy_bindings_account_same_user_fk DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE onchain_policy_bindings ALTER CONSTRAINT onchain_policy_bindings_delegate_same_user_fk DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE onchain_policy_bindings ALTER CONSTRAINT onchain_policy_bindings_owner_same_user_fk DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE signing_delegations ALTER CONSTRAINT signing_delegations_key_same_user_fk DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE signing_delegations ALTER CONSTRAINT signing_delegations_provider_same_user_fk DEFERRABLE INITIALLY IMMEDIATE;
