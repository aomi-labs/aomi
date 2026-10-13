-- Drop the legacy widget-auth account-graph tables (2026-07-11).
--
-- Provenance: the pre-BFF-port `packages/auth` stack (WIDGET-AUTH-PLAN era,
-- 2026-06) kept its own account graph in `aomi_users` / `aomi_auth_identities`
-- / `aomi_wallets` / `aomi_account_events`. The BFF port replaced it with the
-- backend's canonical tables (`users`, `auth_providers`, `public_keys`), and
-- better-auth state lives in the `ba_*` tables. As of 2026-07-11 neither
-- aomi-widget nor product-mono `origin/main` contains a single reference to
-- the four legacy tables — they are orphaned data.
--
-- NOTE: staging and prod share one database (the portal DATABASE_URL); run
-- this once, deliberately. The `ba_*` tables are LIVE better-auth state — do
-- not touch them.

-- ── Pre-flight: eyeball what is being thrown away ──────────────────────────
-- Expect stale timestamps (nothing written since the BFF port shipped) and no
-- foreign keys from outside the legacy quartet.
select 'aomi_users' as t, count(*) from aomi_users
union all select 'aomi_auth_identities', count(*) from aomi_auth_identities
union all select 'aomi_wallets', count(*) from aomi_wallets
union all select 'aomi_account_events', count(*) from aomi_account_events;

select conrelid::regclass as dependent, conname
from pg_constraint
where confrelid::regclass::text
      in ('aomi_users', 'aomi_auth_identities', 'aomi_wallets', 'aomi_account_events')
  and conrelid::regclass::text
      not in ('aomi_users', 'aomi_auth_identities', 'aomi_wallets', 'aomi_account_events');
-- ^ must return 0 rows before dropping.

-- ── Drop ────────────────────────────────────────────────────────────────────
-- Children first so plain RESTRICT drops succeed; no CASCADE, so any
-- dependent this script did not anticipate aborts the transaction instead of
-- being silently destroyed.
begin;
drop table if exists aomi_account_events;
drop table if exists aomi_wallets;
drop table if exists aomi_auth_identities;
drop table if exists aomi_users;
commit;
