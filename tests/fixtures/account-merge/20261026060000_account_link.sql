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
--
-- Core part: the tables and the commit step. Supabase grants and
-- merge_accounts are in supabase/cloud.

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
