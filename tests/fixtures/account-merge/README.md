# Account merge PostgreSQL fixture

`20261007000000_account_merge.sql` is an unmodified copy of the migration in
`aomi-labs/product-mono` PR #1262, commit
`51672d13f`. Keep it aligned with the companion
migration when that changes. `schema.sql` supplies the prerequisite relations,
including the real composite wallet ownership constraints, after the shared
canonical account schema.

The test creates a temporary database because the merge scans the `public`
schema. It applies the fixtures and runs the assertions in a rolled-back
transaction, then drops that database. CI's PostgreSQL service role has
`CREATEDB`; local runs require the same privilege and the disposable test flag.
