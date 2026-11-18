# Account merge PostgreSQL fixture

These fixtures exercise account merges against the current product-mono
schema. Load the shared canonical account schema, then `schema.sql`,
`20261026060000_account_link.sql`, and `routines.sql` in that order.

`schema.sql` supplies the columns and constraints exercised by the merge.
`20261026060000_account_link.sql` mirrors the core account-link migration.
`routines.sql` copies the active merge and preview routines from the cloud
migrations named in its comments.

The merge suite creates a temporary database because the merge scans the
`public` schema. It runs the assertions in a rolled-back transaction and
drops that database. CI's PostgreSQL service role has `CREATEDB`. Local runs
require the same privilege and the disposable test flag.
