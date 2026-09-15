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
-- Keep this provenance list and the post-migration assertions in
-- migrate-browser-contract-db.ts aligned when the backend graph changes.

create extension if not exists pgcrypto;

create table users (
  id text primary key default gen_random_uuid()::text,
  username text unique,
  applications text[] not null default array['default']::text[],
  tier text not null default 'free',
  status text not null default 'active',
  last_seen_at bigint,
  created_at bigint not null default extract(epoch from now())::bigint,
  updated_at bigint not null default extract(epoch from now())::bigint
);

create table auth_providers (
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

create unique index auth_providers_scoped_subject_uidx
  on auth_providers (provider, issuer_environment, tenant_id, subject)
  where subject is not null;
create index auth_providers_user_idx on auth_providers (user_id);
create index auth_providers_verified_value_idx
  on auth_providers (
    provider,
    issuer_environment,
    tenant_id,
    method,
    lower(value)
  )
  where verified_at is not null;

create table public_keys (
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
  constraint public_keys_unique_address unique (chain_type, address),
  constraint public_keys_auth_provider_same_user_fk
    foreign key (auth_provider_id, user_id)
    references auth_providers(id, user_id)
);

create index public_keys_user_idx on public_keys (user_id);
create unique index public_keys_primary_per_provider_uidx
  on public_keys (auth_provider_id)
  where is_primary and auth_provider_id is not null;
