-- Account merge. Signing in to account A and then proving a sign-in method of
-- account B (a wallet signature or a provider token) is proof of both, so B can
-- be folded into A. B stays as a closed record pointing at A.

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

-- Prepared commits keep their snapshot; the one owner change they accept is
-- the move from a merged account to the account it merged into.
CREATE OR REPLACE FUNCTION protect_broadcast_operation_snapshots()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.state <> 'preparing' AND (
        (NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS DISTINCT FROM
            (SELECT merged_into FROM users WHERE id = OLD.user_id)) OR
        NEW.thread_id IS DISTINCT FROM OLD.thread_id OR
        NEW.application_id IS DISTINCT FROM OLD.application_id OR
        NEW.chain_family IS DISTINCT FROM OLD.chain_family OR
        NEW.chain_ref IS DISTINCT FROM OLD.chain_ref OR
        NEW.execution_kind IS DISTINCT FROM OLD.execution_kind OR
        NEW.operating_account_id IS DISTINCT FROM OLD.operating_account_id OR
        NEW.signer IS DISTINCT FROM OLD.signer OR
        NEW.application_calls IS DISTINCT FROM OLD.application_calls OR
        NEW.tx_ids IS DISTINCT FROM OLD.tx_ids OR
        NEW.fee_subjects IS DISTINCT FROM OLD.fee_subjects OR
        NEW.fee_quote IS DISTINCT FROM OLD.fee_quote OR
        NEW.final_calls IS DISTINCT FROM OLD.final_calls OR
        NEW.calls_digest IS DISTINCT FROM OLD.calls_digest OR
        (NEW.prepared_blob IS DISTINCT FROM OLD.prepared_blob
         AND NOT (OLD.commit_request IS NOT NULL
                  AND commit_prepared_evidence_advances(OLD.prepared_blob, NEW.prepared_blob))) OR
        NEW.signature_requests IS DISTINCT FROM OLD.signature_requests OR
        NEW.expires_at IS DISTINCT FROM OLD.expires_at
    ) THEN
        RAISE EXCEPTION 'broadcast operation call, fee and preparation snapshots are immutable after preparation';
    END IF;
    RETURN NEW;
END;
$$;

-- What the source loses because the target already has the same thing. The
-- target's row wins; these names are shown before the user confirms.
CREATE FUNCTION account_merge_dropped(source_user_id TEXT, target_user_id TEXT)
RETURNS TEXT[]
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(array_agg(name ORDER BY name), '{}')
    FROM (
        SELECT CASE k.provider
                   WHEN 'openai' THEN 'OpenAI'
                   WHEN 'openrouter' THEN 'OpenRouter'
                   WHEN 'xai' THEN 'xAI'
                   WHEN 'deepseek' THEN 'DeepSeek'
                   ELSE initcap(k.provider)
               END || ' model key' AS name
        FROM user_model_keys k
        WHERE k.user_id = source_user_id
          AND EXISTS (SELECT 1 FROM user_model_keys t
                      WHERE t.user_id = target_user_id AND t.provider = k.provider)
        UNION ALL
        SELECT COALESCE(NULLIF(a.label, ''), a.name) || ' ' || s.slot_name
        FROM user_application_secrets s
        JOIN applications a ON a.id = s.application_id
        WHERE s.user_id = source_user_id
          AND EXISTS (SELECT 1 FROM user_application_secrets t
                      WHERE t.user_id = target_user_id
                        AND t.application_id = s.application_id
                        AND t.slot_name = s.slot_name)
    ) dropped;
$$;

-- A read-only summary of the source account for the merge offer.
CREATE FUNCTION account_merge_preview(source_user_id TEXT, target_user_id TEXT)
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
                             FROM user_credits_records WHERE account_id = source_user_id),
        'dropped', to_jsonb(account_merge_dropped(source_user_id, target_user_id))
    )
    FROM users u
    WHERE u.id = source_user_id;
$$;

-- Fold the source account into the target in the caller's transaction.
CREATE FUNCTION merge_accounts(source_user_id TEXT, target_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    now_s   BIGINT := EXTRACT(EPOCH FROM NOW())::BIGINT;
    dropped TEXT[];
    chats   BIGINT;
    wallets BIGINT;
    col     RECORD;
BEGIN
    IF source_user_id IS NULL OR target_user_id IS NULL OR source_user_id = target_user_id THEN
        RAISE EXCEPTION 'account_merge_invalid';
    END IF;
    -- The same keys guard unlinking a login factor.
    PERFORM pg_advisory_xact_lock(hashtextextended(key, 0))
    FROM unnest(ARRAY['aomi-login-factors:' || source_user_id, 'aomi-login-factors:' || target_user_id]) AS key
    ORDER BY key;
    PERFORM 1 FROM users WHERE id IN (source_user_id, target_user_id) ORDER BY id FOR UPDATE;
    IF (SELECT count(*) FROM users WHERE id IN (source_user_id, target_user_id) AND status = 'active') <> 2 THEN
        RAISE EXCEPTION 'account_merge_inactive_account';
    END IF;
    IF EXISTS (SELECT 1 FROM account_payment_locks
               WHERE account_id IN (source_user_id, target_user_id) AND expires_at > now_s) THEN
        RAISE EXCEPTION 'account_merge_payment_in_progress';
    END IF;
    DELETE FROM account_payment_locks WHERE account_id = source_user_id;

    -- Closed first: the commit snapshot guard accepts a move to merged_into.
    UPDATE users SET status = 'merged', merged_into = target_user_id, updated_at = now_s
    WHERE id = source_user_id;
    UPDATE users t
       SET applications = ARRAY(SELECT DISTINCT unnest(t.applications || s.applications)),
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

    -- Tables with a per-account unique key: the target's row wins.
    dropped := account_merge_dropped(source_user_id, target_user_id);
    DELETE FROM user_model_keys k
     WHERE k.user_id = source_user_id
       AND EXISTS (SELECT 1 FROM user_model_keys t WHERE t.user_id = target_user_id AND t.provider = k.provider);
    DELETE FROM user_application_secrets s
     WHERE s.user_id = source_user_id
       AND EXISTS (SELECT 1 FROM user_application_secrets t
                   WHERE t.user_id = target_user_id AND t.application_id = s.application_id
                     AND t.slot_name = s.slot_name);
    DELETE FROM user_application_installs i
     WHERE i.user_id = source_user_id
       AND EXISTS (SELECT 1 FROM user_application_installs t
                   WHERE t.user_id = target_user_id AND t.application_id = i.application_id);
    DELETE FROM mcp_session_wallets w
     WHERE w.user_id = source_user_id
       AND EXISTS (SELECT 1 FROM mcp_session_wallets t
                   WHERE t.user_id = target_user_id AND t.session_id = w.session_id
                     AND t.chain_family = w.chain_family);
    -- Daily usage is a counter, so the same day adds up.
    UPDATE user_application_usage_daily t
       SET input_tokens = t.input_tokens + s.input_tokens,
           output_tokens = t.output_tokens + s.output_tokens,
           credits_used = t.credits_used + s.credits_used,
           updated_at = now_s
      FROM user_application_usage_daily s
     WHERE t.user_id = target_user_id AND s.user_id = source_user_id
       AND t.period_utc_day = s.period_utc_day AND t.app_id = s.app_id;
    DELETE FROM user_application_usage_daily s
     WHERE s.user_id = source_user_id
       AND EXISTS (SELECT 1 FROM user_application_usage_daily t
                   WHERE t.user_id = target_user_id AND t.period_utc_day = s.period_utc_day
                     AND t.app_id = s.app_id);

    SELECT count(*) INTO chats FROM threads WHERE user_id = source_user_id;
    SELECT count(*) INTO wallets FROM public_keys WHERE user_id = source_user_id;

    -- Everything else keyed by account, including tables added later. Better
    -- Auth's ba_* tables key their own users, not accounts.
    FOR col IN
        SELECT c.table_name, c.column_name
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public'
           AND t.table_type = 'BASE TABLE'
           AND c.column_name IN ('user_id', 'account_id', 'owner_user_id', 'claimed_user_id')
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
    UPDATE task_preparation_limits
       SET owner_subject = CASE WHEN owner_subject = source_user_id THEN target_user_id ELSE 'account:' || target_user_id END
     WHERE owner_subject IN (source_user_id, 'account:' || source_user_id);

    SET CONSTRAINTS public_keys_auth_provider_same_user_fk,
                    operating_accounts_owner_same_user_fk,
                    onchain_policy_bindings_account_same_user_fk,
                    onchain_policy_bindings_delegate_same_user_fk,
                    onchain_policy_bindings_owner_same_user_fk,
                    signing_delegations_key_same_user_fk,
                    signing_delegations_provider_same_user_fk IMMEDIATE;

    RETURN jsonb_build_object(
        'source', source_user_id,
        'target', target_user_id,
        'chats', chats,
        'wallets', wallets,
        'dropped', to_jsonb(dropped)
    );
END;
$$;

REVOKE ALL ON FUNCTION account_merge_dropped(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION account_merge_preview(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION merge_accounts(TEXT, TEXT) FROM PUBLIC;

-- Supabase supplies these roles; plain PostgreSQL development/CI does not.
DO $$
DECLARE role_name TEXT;
BEGIN
    FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
        EXECUTE format('REVOKE ALL ON account_merge_tickets FROM %I', role_name);
    END LOOP;
END;
$$;
