-- Account merge routines from product-mono's cloud migrations.
-- account_merge_dropped and merge_accounts: 20261116120000_unified_packages.sql.
CREATE OR REPLACE FUNCTION public.account_merge_dropped(source_user_id text, target_user_id text) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(name ORDER BY name), '{}') FROM (
    SELECT COALESCE(NULLIF(p.display_name, ''), p.name) || ' · ' || s.slot || CASE
      WHEN EXISTS (SELECT 1 FROM user_package_secrets t WHERE t.user_id=target_user_id
        AND t.package_id=s.package_id AND t.slot=s.slot)
      THEN ' (you already have one here)' ELSE ' (re-enter it after merging)' END AS name
    FROM user_package_secrets s JOIN packages p ON p.id=s.package_id
    WHERE s.user_id=source_user_id
  ) dropped;
$$;

-- merge_accounts v6: v5 without `users.applications`; installs, person
-- secrets and daily usage under their package and agent names; package
-- grants move with the account.
CREATE OR REPLACE FUNCTION public.merge_accounts(source_user_id TEXT, target_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    now_s     BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
    dropped   TEXT[];
    chats     BIGINT;
    wallets   BIGINT;
    cancelled INTEGER;
    col       RECORD;
BEGIN
    IF source_user_id IS NULL OR target_user_id IS NULL OR source_user_id = target_user_id THEN
        RAISE EXCEPTION 'account_merge_invalid';
    END IF;
    -- The same keys guard unlinking a login factor.
    PERFORM pg_advisory_xact_lock(hashtextextended(key, 0))
    FROM unnest(ARRAY['aomi-login-factors:' || source_user_id, 'aomi-login-factors:' || target_user_id]) AS key
    ORDER BY key;
    -- Commit Service holds this barrier shared for every admission write, so
    -- none is mid-flight while ownership moves.
    PERFORM pg_advisory_xact_lock(hashtextextended('aomi-commit-admission:' || key, 0))
    FROM unnest(ARRAY[source_user_id, target_user_id]) AS key ORDER BY key;
    -- Same short lock as admission, exposure, and accounting. Take it before
    -- row locks so funds cannot be reserved concurrently with the merge.
    PERFORM pg_advisory_xact_lock(hashtextextended(key, 0))
    FROM unnest(ARRAY[source_user_id, target_user_id]) AS key ORDER BY key;
    PERFORM 1 FROM users WHERE id IN (source_user_id, target_user_id) ORDER BY id FOR UPDATE;
    IF (SELECT count(*) FROM users WHERE id IN (source_user_id, target_user_id) AND status = 'active') <> 2 THEN
        RAISE EXCEPTION 'account_merge_inactive_account';
    END IF;
    IF EXISTS (SELECT 1 FROM account_payment_locks
               WHERE account_id IN (source_user_id, target_user_id) AND expires_at > now_s) THEN
        RAISE EXCEPTION 'account_merge_payment_in_progress';
    END IF;
    IF EXISTS (SELECT 1 FROM payment_runs
               WHERE principal_kind='account' AND principal_id IN (source_user_id, target_user_id)
                 -- A finished run holds nothing, whatever reservation it last recorded.
                 AND state IN ('ready','running') AND (expires_at>now_s OR reserved_microusd>0)) THEN
        RAISE EXCEPTION 'account_merge_payment_in_progress';
    END IF;
    IF EXISTS (SELECT 1 FROM account_merge_fences
               WHERE fenced_account IN (source_user_id, target_user_id) AND expires_at > now_s) THEN
        RAISE EXCEPTION 'account_merge_in_progress';
    END IF;
    -- A moved non-terminal commit would never advance: its request keeps the
    -- source id.
    cancelled := account_merge_commits(source_user_id);
    DELETE FROM account_payment_locks WHERE account_id = source_user_id;

    -- Closed first: the commit snapshot guard accepts a move to merged_into.
    UPDATE users SET status = 'merged', merged_into = target_user_id, updated_at = now_s
    WHERE id = source_user_id;
    UPDATE users t
       -- A pause on either account survives the merge.
       SET agents_paused = t.agents_paused OR s.agents_paused,
           updated_at = now_s
      FROM users s
     WHERE t.id = target_user_id AND s.id = source_user_id;

    SET CONSTRAINTS public_keys_auth_provider_same_user_fk,
                    operating_accounts_owner_same_user_fk,
                    onchain_policy_bindings_account_same_user_fk,
                    onchain_policy_bindings_delegate_same_user_fk,
                    onchain_policy_bindings_owner_same_user_fk,
                    signing_delegations_key_same_user_fk,
                    signing_delegations_provider_same_user_fk DEFERRED;

    -- Drop owner-bound ciphertexts before the ownership sweep, including non-clashes.
    dropped := account_merge_dropped(source_user_id, target_user_id);
    DELETE FROM user_package_secrets WHERE user_id = source_user_id;

    -- Tables with a per-account unique key: the target's row wins.
    -- A connection both accounts have keeps the target's row; the source's
    -- wallet access moves onto it first (the target's row wins a real
    -- conflict), so deleting the source row loses none.
    INSERT INTO wallet_access (user_id, connection_key, agent_wallet_id, lane, created_at, updated_at)
    SELECT target_user_id, p.connection_key, p.agent_wallet_id, p.lane, p.created_at, now_s
      FROM wallet_access p
     WHERE p.user_id = source_user_id
       AND EXISTS (SELECT 1 FROM account_connections t
                   WHERE t.user_id = target_user_id AND t.key = p.connection_key)
    ON CONFLICT DO NOTHING;
    DELETE FROM account_connections s
     WHERE s.user_id = source_user_id
       AND EXISTS (SELECT 1 FROM account_connections t
                   WHERE t.user_id = target_user_id AND t.key = s.key);
    DELETE FROM user_packages i
     WHERE i.user_id = source_user_id
       AND EXISTS (SELECT 1 FROM user_packages t
                   WHERE t.user_id = target_user_id AND t.package_id = i.package_id);
    -- A package both accounts hold keeps the target's active grant.
    UPDATE package_grants s SET revoked_at = now_s
     WHERE s.account_id = source_user_id AND s.revoked_at IS NULL
       AND EXISTS (SELECT 1 FROM package_grants t
                   WHERE t.account_id = target_user_id AND t.package_id = s.package_id
                     AND t.revoked_at IS NULL);
    -- Daily usage is a counter, so the same day adds up.
    UPDATE agent_usage_daily t
       SET input_tokens = t.input_tokens + s.input_tokens,
           output_tokens = t.output_tokens + s.output_tokens,
           credits_used = t.credits_used + s.credits_used,
           updated_at = now_s
      FROM agent_usage_daily s
     WHERE t.user_id = target_user_id AND s.user_id = source_user_id
       AND t.period_utc_day = s.period_utc_day AND t.agent_id = s.agent_id;
    DELETE FROM agent_usage_daily s
     WHERE s.user_id = source_user_id
       AND EXISTS (SELECT 1 FROM agent_usage_daily t
                   WHERE t.user_id = target_user_id AND t.period_utc_day = s.period_utc_day
                     AND t.agent_id = s.agent_id);

    SELECT count(*) INTO chats FROM threads WHERE user_id = source_user_id;
    SELECT count(*) INTO wallets FROM public_keys WHERE user_id = source_user_id;

    UPDATE funding_event SET owner_id=target_user_id WHERE owner_kind='account' AND owner_id=source_user_id;
    UPDATE credit_ledger SET owner_id=target_user_id WHERE owner_kind='account' AND owner_id=source_user_id;

    -- Everything else keyed by account, including tables added later. Better
    -- Auth's ba_* tables key their own users, not accounts.
    FOR col IN
        SELECT c.table_name, c.column_name
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public'
           AND t.table_type = 'BASE TABLE'
           AND c.column_name IN ('user_id', 'account_id', 'owner_user_id')
           AND c.data_type = 'text'
           AND c.table_name NOT LIKE 'ba\_%'
         ORDER BY c.table_name, c.column_name
    LOOP
        EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2',
                       col.table_name, col.column_name, col.column_name)
          USING target_user_id, source_user_id;
    END LOOP;

    -- Owner subjects stored as text.
    UPDATE payment_runs SET principal_id = target_user_id
     WHERE principal_kind = 'account' AND principal_id = source_user_id;
    UPDATE x402_attempts SET principal_id = target_user_id
     WHERE principal_kind = 'account' AND principal_id = source_user_id;
    UPDATE llm_usage_events SET subject_id = target_user_id
     WHERE subject_kind = 'account' AND subject_id = source_user_id;
    UPDATE thread_agent_requests
       SET owner_subject = CASE WHEN owner_subject = source_user_id THEN target_user_id ELSE 'account:' || target_user_id END
     WHERE owner_subject IN (source_user_id, 'account:' || source_user_id);
    UPDATE thread_agent_events
       SET action_owner_subject = CASE WHEN action_owner_subject = source_user_id THEN target_user_id ELSE 'account:' || target_user_id END
     WHERE action_owner_subject IN (source_user_id, 'account:' || source_user_id);
    -- Task jobs are wallet-payer bound and are not account-owned.

    SET CONSTRAINTS public_keys_auth_provider_same_user_fk,
                    operating_accounts_owner_same_user_fk,
                    onchain_policy_bindings_account_same_user_fk,
                    onchain_policy_bindings_delegate_same_user_fk,
                    onchain_policy_bindings_owner_same_user_fk,
                    signing_delegations_key_same_user_fk,
                    signing_delegations_provider_same_user_fk IMMEDIATE;

    -- Admission reopens with the merge's commit.
    DELETE FROM account_merge_fences WHERE fenced_account IN (source_user_id, target_user_id);

    RETURN jsonb_build_object(
        'source', source_user_id,
        'target', target_user_id,
        'chats', chats,
        'wallets', wallets,
        'cancelled', cancelled,
        'dropped', to_jsonb(dropped)
    );
END;
$$;

-- account_merge_preview: 20261024010000_canonical_credit_names.sql.
CREATE OR REPLACE FUNCTION account_merge_preview(source_user_id TEXT, target_user_id TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT jsonb_build_object(
        'name', u.username,
        'created_at', u.created_at,
        'chats', (SELECT count(*) FROM threads WHERE user_id = source_user_id),
        'wallets', (SELECT count(*) FROM public_keys WHERE user_id = source_user_id),
        'credits_microusd', (SELECT COALESCE(sum(amount_microusd), 0)
                             FROM credit_ledger WHERE owner_kind='account' AND owner_id = source_user_id),
        'dropped', to_jsonb(account_merge_dropped(source_user_id, target_user_id))
    )
    FROM users u
    WHERE u.id = source_user_id;
$$;

REVOKE ALL ON FUNCTION account_merge_dropped(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION account_merge_preview(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION merge_accounts(TEXT, TEXT) FROM PUBLIC;
