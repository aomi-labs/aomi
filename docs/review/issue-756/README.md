# Private app Library evidence

Captured locally on 2026-10-19 using the production Portal build, at
1440 × 1000 and 400 × 844. The disposable private app is **Treasury Assistant**
(application 23). These are browser screenshots, with the key input masked.

## Verified

Both desktop and mobile journeys passed:

1. Default chat has no standalone App key control.
2. Library search exposes **Add private app**.
3. The real Rust resolver rejects an invalid key with actionable feedback.
4. A generated valid key resolves application 23 and adds it to Installed.
5. Re-adding the same app preserves access without adding another row.
6. The normal app picker inserts the private app mention. The chat request
   contains its exact application identity and carries its key only in the
   `Aomi-App-Key` header. The message body contains no key.
7. A subsequent public chat sends no private-app key.

Separate database-backed Rust tests cover account installation, duplicate
installation, wrong-key rejection, revocation, inactive apps, and exact identity.
Runtime tests cover two apps retaining separate keys and rejecting ambiguous
multi-private-app messages.

## Coverage boundary

The Portal runs at `http://127.0.0.1:3463` with real Better Auth guest cookies
and a disposable local PostgreSQL database. Key resolution is forwarded by the
browser test to the companion Rust backend's disposable router on port 3482.
Other catalog/account upstream responses and Agent replies are controlled test
fixtures. The chat screenshots deliberately show the fixture's echoed reply;
they prove UI and credential transport, not a live model or private app tool run.
The browser scenario adds the app to a guest's in-memory Library. Durable
signed-in account installation is covered by the Rust HTTP/database tests.

Frontend source: `codex/private-app-library` in `aomi-labs/aomi`.
Backend fixture source: `6fa69ca32` in `aomi-labs/product-mono`, PR #1374.
No hosted database, production credential, or wallet transaction is involved.

## Reproduction

The opt-in configuration is `playwright.private-app.config.ts`; the scenario is
`tests/e2e/private-app-library.local.spec.ts`. It is excluded from ordinary CI
journey selection because it needs the real local resolver fixture.

Prepare an isolated backend database with all committed migrations. Through
`aomi-dev cargo`, run the ignored backend library test
`shared_key_browser_fixture`, setting `DATABASE_URL` to that database and
`PRIVATE_APP_FIXTURE_FILE` to an ignored temporary file. The fixture writes a
disposable key with mode 0600 and listens only on loopback port 3482. Never
commit that file, browser traces, or raw request headers.

The frontend test needs the same `PRIVATE_APP_FIXTURE_FILE`, a separate
`AOMI_TEST_DATABASE_URL`, and `AOMI_TEST_DATABASE_DISPOSABLE=1` to confirm that
the Portal's browser-contract schema may be reset. Run
`pnpm exec playwright test --config playwright.private-app.config.ts` through
the Aomi manager. On this host the production build needed the supported
**standard runtime profile**: the ordinary 6 GiB exec scope repeatedly throttled
compilation, while the standard profile completed both journeys in 1.3 minutes.

## Screenshots

| State                    | Desktop                           | Mobile                            |
| ------------------------ | --------------------------------- | --------------------------------- |
| Library entry point      | [Library](portal-library.png)     | [Library](mobile-library.png)     |
| Key dialog               | [Dialog](portal-dialog.png)       | [Dialog](mobile-dialog.png)       |
| Invalid key              | [Error](portal-invalid-key.png)   | [Error](mobile-invalid-key.png)   |
| Correct app added        | [Success](portal-added.png)       | [Success](mobile-added.png)       |
| Installed app            | [Installed](portal-installed.png) | [Installed](mobile-installed.png) |
| Controlled chat response | [Chat](portal-chat.png)           | [Chat](mobile-chat.png)           |
