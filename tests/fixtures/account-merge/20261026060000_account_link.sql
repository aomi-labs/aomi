-- Agent Wallets step 5: link a platform account (Telegram first) to a portal account.
--
-- A platform mints a one-time code; the signed-in portal account
-- confirms it, and the platform account merges into it (`merge_accounts`).
-- While the link runs, a fence on both accounts refuses new commit
-- admission, and the merge cancels the source's unsigned commits. A source
-- commit that is signed or sent blocks the merge until it settles.
--
-- Online-compatible: new tables and function bodies that
-- old writers tolerate (a cancelled commit is an ordinary `rejected` row).

-- One-time link codes: a platform identity (Telegram, ...) folds into the
-- portal account that confirms one. Their columns avoid the names the merge
-- sweep moves.
CREATE TABLE IF NOT EXISTS public.account_link_codes (
    id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    -- sha256(code), hex. The code itself is only ever in the platform's button.
    code_hash           TEXT    NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    -- The account the identity resolved to at issue time.
    source_user_id      TEXT    NOT NULL REFERENCES public.users(id),
    -- auth_providers.provider and .subject of the identity.
    provider            TEXT    NOT NULL,
    subject             TEXT    NOT NULL,
    handle              TEXT,
    -- What the platform's adapter needs (Telegram: bot_id, bot_registration_id, chat_id).
    context             JSONB   NOT NULL DEFAULT '{}',
    state               TEXT    NOT NULL DEFAULT 'issued'
                        CHECK (state IN ('issued', 'linking', 'linked', 'cancelled', 'superseded')),
    -- The portal account that claimed it.
    target_user_id      TEXT    REFERENCES public.users(id),
    merge_id            UUID,
    -- Lease while the link protocol runs.
    linking_until       BIGINT,
    -- What the platform reports and a replayed confirm returns.
    result              JSONB,
    created_at          BIGINT  NOT NULL,
    expires_at          BIGINT  NOT NULL,
    consumed_at         BIGINT,
    notified_at         BIGINT,
    CHECK (expires_at = created_at + 600),
    CHECK (state <> 'linking'
           OR (target_user_id IS NOT NULL AND merge_id IS NOT NULL AND linking_until IS NOT NULL)),
    CHECK (state <> 'linked' OR (target_user_id IS NOT NULL AND consumed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS account_link_codes_identity
    ON public.account_link_codes (provider, subject, created_at DESC);
CREATE INDEX IF NOT EXISTS account_link_codes_target
    ON public.account_link_codes (target_user_id) WHERE state = 'linked';
CREATE INDEX IF NOT EXISTS account_link_codes_notify
    ON public.account_link_codes (provider, consumed_at) WHERE state = 'linked' AND notified_at IS NULL;
ALTER TABLE public.account_link_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_link_codes FROM PUBLIC;

-- Commit admission is refused for an account with a live fence. The fence
-- expires on its own, so a crashed link heals. `fenced_account`, not
-- `account_id`: the merge sweep must not move it.
CREATE TABLE IF NOT EXISTS public.account_merge_fences (
    fenced_account TEXT   PRIMARY KEY REFERENCES public.users(id),
    merge_id       UUID   NOT NULL,
    reason         TEXT   NOT NULL CHECK (reason IN ('account_link')),
    created_at     BIGINT NOT NULL,
    expires_at     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_merge_fences_merge ON public.account_merge_fences (merge_id);
ALTER TABLE public.account_merge_fences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_merge_fences FROM PUBLIC;

-- How an account merge treats a Commit Service row: 'cancel'
-- when nothing was signed (parked, or waiting for a signature with no
-- signature or wallet attempt recorded), 'wait' once it is signed or sent,
-- Recent expired rows with signed evidence also wait; NULL otherwise.
CREATE OR REPLACE FUNCTION public.commit_merge_action(state TEXT, signed BOOLEAN, recent BOOLEAN)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        -- A browser wallet can still broadcast an attempt the tick expired.
        WHEN state = 'expired' AND signed AND recent THEN 'wait'
        WHEN state = 'awaiting_approval' THEN 'cancel'
        WHEN state = 'needs_signature' AND NOT signed THEN 'cancel'
        WHEN state IN ('needs_signature', 'awaiting_broadcast', 'submitted') THEN 'wait'
    END
$$;

-- The merge's commit step, run under the merge's admission barrier: refuse
-- while a source commit is signed or sent, else reject every unsigned one.
-- Each reject bumps `version`, so a racing Commit Service write (a CAS on
-- `version`) loses and nothing it signed is broadcast. Returns the count.
CREATE OR REPLACE FUNCTION public.account_merge_commits(source_user_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    cancelled INTEGER;
BEGIN
    PERFORM 1 FROM commits
     WHERE user_id = source_user_id AND commit_request IS NOT NULL
       AND state IN ('awaiting_approval', 'needs_signature', 'awaiting_broadcast', 'submitted')
     ORDER BY id
       FOR UPDATE;
    IF EXISTS (SELECT 1 FROM commits
                WHERE user_id = source_user_id AND commit_request IS NOT NULL
                  AND commit_merge_action(state, signed_blob IS NOT NULL
                                                 OR provider_operation_id IS NOT NULL,
                                      updated_at > EXTRACT(EPOCH FROM NOW()) - 900) = 'wait') THEN
        RAISE EXCEPTION 'account_merge_commits_in_flight';
    END IF;
    UPDATE commits
       SET state = 'rejected', failure_code = 'commit_account_merged',
           version = version + 1, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
     WHERE user_id = source_user_id AND commit_request IS NOT NULL
       AND commit_merge_action(state, signed_blob IS NOT NULL
                                      OR provider_operation_id IS NOT NULL,
                                      updated_at > EXTRACT(EPOCH FROM NOW()) - 900) = 'cancel';
    GET DIAGNOSTICS cancelled = ROW_COUNT;
    RETURN cancelled;
END;
$$;
REVOKE ALL ON FUNCTION public.account_merge_commits(TEXT) FROM PUBLIC;

-- One Telegram approval card per (commit, version, bot). The bot that sent a
-- card is the only one that can approve through it.
CREATE TABLE IF NOT EXISTS public.telegram_approval_cards (
    -- CSPRNG, about 71 bits.
    token          TEXT    PRIMARY KEY CHECK (token ~ '^[A-Za-z0-9]{12}$'),
    user_id        TEXT    NOT NULL REFERENCES public.users(id),
    -- The ref shown: the single commit, or batch member index 0.
    commit_id      UUID    NOT NULL,
    batch_id       TEXT,
    -- commit_id's version when the card was rendered.
    version        BIGINT  NOT NULL,
    -- '' when the commit has no review.
    review_digest  TEXT    NOT NULL,
    -- platform_bot_id; the commit's notify is 'telegram:' || bot_id.
    bot_id         TEXT    NOT NULL,
    -- DM chat id, equal to the Telegram user id.
    chat_id        BIGINT  NOT NULL,
    message_id     INTEGER,
    state          TEXT    NOT NULL DEFAULT 'sending'
                   CHECK (state IN ('sending', 'open', 'approving', 'approved', 'cancelled',
                                    'expired', 'stale', 'failed')),
    -- The last commit state rendered into the message, to edit only on change.
    rendered       TEXT,
    created_at     BIGINT  NOT NULL,
    updated_at     BIGINT  NOT NULL,
    UNIQUE (commit_id, version, bot_id)
);

ALTER TABLE public.telegram_approval_cards ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS telegram_approval_cards_live ON public.telegram_approval_cards (bot_id, state)
    WHERE state IN ('sending', 'open', 'approving', 'approved');

DO $$
DECLARE role_name TEXT;
BEGIN
    FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
        EXECUTE format('REVOKE ALL ON public.account_link_codes FROM %I', role_name);
        EXECUTE format('REVOKE ALL ON public.account_merge_fences FROM %I', role_name);
        EXECUTE format('REVOKE ALL ON FUNCTION public.account_merge_commits(TEXT) FROM %I', role_name);
    END LOOP;
END;
$$;

-- v3: the commit-admission barrier, refusals for a link in progress and a
-- double World binding, the source's commits (above), and the fences lifted
-- in the same transaction as the merge. A link deletes its own fences in the
-- transaction that calls this, so any fence still live here is another
-- merge's. The signature and grants are unchanged.
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
    -- One live World binding per account and bot: the sweep would collide.
    IF EXISTS (SELECT 1 FROM bot_handover_tokens s
                 JOIN bot_handover_tokens t ON t.bot_registration_id = s.bot_registration_id
                WHERE s.claimed_user_id = source_user_id AND t.claimed_user_id = target_user_id
                  AND s.state IN ('claimed', 'active') AND t.state IN ('claimed', 'active')
                  AND s.owner_address IS NOT NULL AND t.owner_address IS NOT NULL) THEN
        RAISE EXCEPTION 'account_merge_handover_conflict';
    END IF;
    -- A moved non-terminal commit would never advance: its request keeps the
    -- source id.
    cancelled := account_merge_commits(source_user_id);
    DELETE FROM account_payment_locks WHERE account_id = source_user_id;

    -- Closed first: the commit snapshot guard accepts a move to merged_into.
    UPDATE users SET status = 'merged', merged_into = target_user_id, updated_at = now_s
    WHERE id = source_user_id;
    UPDATE users t
       SET applications = ARRAY(SELECT DISTINCT unnest(t.applications || s.applications)),
           -- A pause on either account survives the merge.
           agents_paused = t.agents_paused OR s.agents_paused,
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
    DELETE FROM user_model_keys WHERE user_id = source_user_id;
    DELETE FROM user_application_secrets WHERE user_id = source_user_id;

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
    DELETE FROM user_application_installs i
     WHERE i.user_id = source_user_id
       AND EXISTS (SELECT 1 FROM user_application_installs t
                   WHERE t.user_id = target_user_id AND t.application_id = i.application_id);
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
