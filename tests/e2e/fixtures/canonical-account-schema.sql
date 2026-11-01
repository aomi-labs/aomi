-- Browser-contract snapshot of the canonical account graph owned by
-- product-mono Supabase migrations. This is intentionally the domain schema,
-- not a second frontend account model. It is the final shape required by
-- packages/account after:
--   20260310000000_oauth_entitlements_usage.sql
--   20260522000000_identity_wallets_and_app_grants.sql
--   20260701010000_account_model_consolidation.sql
--   20260701020000_account_model_contract.sql
--   20260701030000_account_model_slim.sql
--   20260725000000_auth_provider_scope.sql
--   20260726020000_signing_mode_rename.sql
--   20260726030000_public_keys_provider_managed.sql
--   20261101020000_public_keys_login_allowed.sql
--   20261020040000_agent_wallets.sql (agent_wallets, agent_wallet_keys,
--     users.agents_paused, account_connections and wallet_access; without
--     the backfill and the composite same-user foreign keys)
--   applications: only the columns wallet lists and the connections route read
--   threads and bot_registrations: only the columns the Telegram part of
--     GET /v1/account/connections reads
--   20261026060000_account_link.sql (account_link_codes only: the
--     connections route reads linked_from/linked_at from it)
-- Keep this provenance list and the post-migration assertions in
-- migrate-browser-contract-db.ts aligned when the backend graph changes.

create extension if not exists pgcrypto;

create table if not exists users (
  id text primary key default gen_random_uuid()::text,
  username text unique,
  applications text[] not null default array['default']::text[],
  tier text not null default 'free',
  status text not null default 'active',
  last_seen_at bigint,
  -- Pause all: while set, no agent wallet of the account signs.
  agents_paused boolean not null default false,
  created_at bigint not null default extract(epoch from now())::bigint,
  updated_at bigint not null default extract(epoch from now())::bigint
);

create table if not exists auth_providers (
  id bigserial primary key,
  user_id text not null references users(id) on delete cascade,
  provider text not null,
  issuer_environment text not null check (btrim(issuer_environment) <> ''),
  tenant_id text not null check (btrim(tenant_id) <> ''),
  subject text,
  method text not null,
  value text not null,
  verified_at bigint,
  is_primary boolean not null default false,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at bigint not null,
  updated_at bigint not null,
  constraint auth_providers_id_user_id_key unique (id, user_id)
);

create unique index if not exists auth_providers_scoped_subject_uidx
  on auth_providers (provider, issuer_environment, tenant_id, subject)
  where subject is not null;
create index if not exists auth_providers_user_idx on auth_providers (user_id);
create index if not exists auth_providers_verified_value_idx
  on auth_providers (
    provider,
    issuer_environment,
    tenant_id,
    method,
    lower(value)
  )
  where verified_at is not null;

create table if not exists public_keys (
  id bigserial primary key,
  chain_type text not null,
  address text not null,
  user_id text not null references users(id) on delete cascade,
  auth_provider_id bigint,
  is_primary boolean not null default false,
  signing_mode text not null default 'manual',
  authorization_version bigint not null default 0,
  authorization_metadata jsonb not null default '{}'::jsonb,
  provider_managed boolean not null default false,
  login_allowed boolean not null default true,
  created_at bigint not null,
  updated_at bigint not null,
  constraint public_keys_unique_address unique (chain_type, address),
  constraint public_keys_auth_provider_same_user_fk
    foreign key (auth_provider_id, user_id)
    references auth_providers(id, user_id)
);

create index if not exists public_keys_user_idx on public_keys (user_id);
create unique index if not exists public_keys_primary_per_provider_uidx
  on public_keys (auth_provider_id)
  where is_primary and auth_provider_id is not null;

-- Only the columns wallet lists and the connections route read.
create table if not exists applications (
  id bigserial primary key,
  name text not null,
  label text not null
);

-- The wallet the user sees. No account has one by default.
create table if not exists agent_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id),
  name text not null check (length(name) between 1 and 60),
  para_subject text not null unique,
  paused boolean not null default false,
  archived_at bigint,
  created_by_app bigint references applications(id),
  last_used_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  constraint agent_wallets_id_user_key unique (id, user_id)
);
create index if not exists agent_wallets_user on agent_wallets (user_id);

-- One row per family key of a wallet. `public_key_id` is NULL only while
-- Para provisions the key.
create table if not exists agent_wallet_keys (
  agent_wallet_id uuid not null,
  chain_type text not null check (chain_type in ('evm', 'svm')),
  user_id text not null references users(id),
  public_key_id bigint unique,
  created_at bigint not null,
  updated_at bigint not null,
  primary key (agent_wallet_id, chain_type)
);
create index if not exists agent_wallet_keys_user on agent_wallet_keys (user_id);

-- Each connection's label, app lock, Ask-only and last use, and which agent
-- wallets each connection may use.
create table if not exists account_connections (
  user_id text not null references users(id),
  key text not null
    check (key ~ '^(portal|cli|[a-z]+:[A-Za-z0-9._~-]{1,200})$'),
  label text,
  application_id bigint references applications(id),
  ask_only boolean not null default false,
  last_used_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  primary key (user_id, key)
);

create table if not exists wallet_access (
  user_id text not null,
  connection_key text not null,
  agent_wallet_id uuid not null,
  lane text not null default 'portal' check (lane in ('portal', 'here', 'instant')),
  created_at bigint not null,
  updated_at bigint not null,
  primary key (user_id, connection_key, agent_wallet_id),
  constraint wallet_access_connection_fk foreign key (user_id, connection_key)
    references account_connections (user_id, key) on update cascade on delete cascade
);
create index if not exists wallet_access_wallet on wallet_access (agent_wallet_id);

create table if not exists threads (
  id text primary key,
  user_id text references users(id)
);

create table if not exists bot_registrations (
  id text primary key,
  owner_user_id text references users(id),
  platform text not null,
  status text not null default 'active',
  label text,
  platform_bot_id text not null,
  platform_username text,
  created_at bigint not null,
  updated_at bigint not null,
  unique (platform, platform_bot_id)
);

-- One-time link codes (product-mono 20261026060000_account_link).
create table if not exists account_link_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  source_user_id text not null references users(id),
  provider text not null,
  subject text not null,
  handle text,
  context jsonb not null default '{}',
  state text not null default 'issued'
    check (state in ('issued', 'linking', 'linked', 'cancelled', 'superseded')),
  target_user_id text references users(id),
  merge_id uuid,
  linking_until bigint,
  result jsonb,
  created_at bigint not null,
  expires_at bigint not null,
  consumed_at bigint,
  notified_at bigint,
  check (expires_at = created_at + 600),
  check (state <> 'linking' or (target_user_id is not null and merge_id is not null and linking_until is not null)),
  check (state <> 'linked' or (target_user_id is not null and consumed_at is not null))
);
