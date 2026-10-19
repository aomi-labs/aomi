-- Prerequisites for the unmodified account-merge migration below and the
-- step 5 `merge_accounts` v3 (20261019070000_telegram_link.sql).
-- The account graph comes from tests/e2e/fixtures/canonical-account-schema.sql.
-- Wallet tables/constraints are copied from product-mono's
-- 20260825010000_public_key_swig_bindings.sql; other tables retain the columns
-- and ownership/uniqueness constraints exercised by the merge routine.
-- This fixture is not a replacement for the backend's full migration tests.

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

create table if not exists threads (
  id text primary key,
  user_id text not null references users(id)
);

create table user_credits_records (
  id bigserial primary key,
  account_id text not null references users(id),
  amount_microusd bigint not null,
  entry_kind text not null,
  payment_method text not null,
  payment_provider text not null,
  external_payment_reference text not null,
  idempotency_key text not null unique,
  created_at bigint not null
);

create table account_payment_locks (
  account_id text primary key references users(id),
  expires_at bigint not null
);

create table user_model_keys (
  user_id text not null references users(id),
  provider text not null,
  key_ciphertext text not null,
  created_at bigint not null,
  updated_at bigint not null,
  primary key (user_id, provider)
);

create table user_application_secrets (
  user_id text not null references users(id),
  application_id bigint not null references applications(id),
  slot_name text not null,
  secret_ciphertext text not null,
  primary key (user_id, application_id, slot_name)
);

create table user_application_installs (
  user_id text not null references users(id),
  application_id bigint not null references applications(id),
  primary key (user_id, application_id)
);

create table mcp_session_wallets (
  user_id text not null references users(id),
  session_id text not null,
  chain_family text not null,
  primary key (user_id, session_id, chain_family)
);

create table user_application_usage_daily (
  user_id text not null references users(id),
  app_id text not null,
  period_utc_day date not null,
  input_tokens bigint not null,
  output_tokens bigint not null,
  credits_used bigint not null,
  updated_at bigint not null,
  primary key (user_id, app_id, period_utc_day)
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
-- Read by 20261007000000_account_merge.sql; v3 no longer moves it.
create table task_preparation_limits (owner_subject text);

-- Commit Service rows: only the columns merge_accounts v3 reads and writes.
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

-- World handovers: the columns and live-binding key merge_accounts v3 checks.
create table bot_handover_tokens (
  id bigserial primary key,
  bot_registration_id text not null references bot_registrations(id),
  state text not null,
  claimed_user_id text references users(id),
  owner_address text
);
create unique index bot_handover_tokens_one_live_per_user_per_bot_uidx
  on bot_handover_tokens (bot_registration_id, claimed_user_id)
  where state in ('claimed', 'active') and owner_address is not null;

-- From 20261019040000_agent_wallets.sql: when both accounts link the same
-- app, the link to the older wallet stays; the other wallet becomes
-- "<name> (2)" with no link.
create function app_wallet_links_merge()
returns trigger
language plpgsql
as $$
declare
  other app_wallet_links%rowtype;
  loser bigint;
begin
  if new.user_id is not distinct from old.user_id then
    return new;
  end if;
  select * into other from app_wallet_links
   where user_id = new.user_id and application_id = new.application_id;
  if not found then
    return new;
  end if;
  select g.id into loser from agent_wallet_groups g
   where g.id in (new.group_id, other.group_id)
   order by g.created_at desc, g.id desc
   limit 1;
  update agent_wallet_groups
     set name = left(name, 56) || ' (2)', updated_at = extract(epoch from now())::bigint
   where id = loser;
  if loser = new.group_id then
    delete from app_wallet_links
     where user_id = old.user_id and application_id = old.application_id;
    return null;
  end if;
  delete from app_wallet_links
   where user_id = other.user_id and application_id = other.application_id;
  return new;
end;
$$;

create trigger app_wallet_links_merge
  before update of user_id on app_wallet_links
  for each row execute function app_wallet_links_merge();
