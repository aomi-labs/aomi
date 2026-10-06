-- One fixed-window counter per key, shared by every frontend instance for the
-- Better Auth and widget sign-in limits. A window starts with the first request
-- for a key and resets only when expires_at passes. Old binaries ignore it.
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL CHECK (count > 0),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_expiry_idx ON rate_limits (expires_at);

-- Only the server's own database role touches these counters. Supabase's
-- browser roles must not read or reset them through the REST API.
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rate_limits FROM PUBLIC;
DO $$
DECLARE role_name TEXT;
BEGIN
    FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
        EXECUTE format('REVOKE ALL ON rate_limits FROM %I', role_name);
    END LOOP;
END;
$$;
