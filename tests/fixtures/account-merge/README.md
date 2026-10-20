# Account merge PostgreSQL fixture

`20261007000000_account_merge.sql` is an unmodified copy of the migration in
`aomi-labs/product-mono` PR #1262, commit
`51672d13f`. `20261020070000_telegram_link.sql` is an unmodified copy of product-mono's
Agent Wallets step 5 migration (`merge_accounts` v3, link codes and merge fences). Keep both
aligned with the companion migrations when those change. `schema.sql` supplies
the prerequisite relations, including the real composite wallet ownership
constraints, and the commit and World handover
columns v3 reads, after the shared canonical account schema.

The test creates a temporary database because the merge scans the `public`
schema. It applies the fixtures and runs the assertions in a rolled-back
transaction, then drops that database. CI's PostgreSQL service role has
`CREATEDB`; local runs require the same privilege and the disposable test flag.
