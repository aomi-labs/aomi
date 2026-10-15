---
"@aomi-labs/client": minor
"@aomi-labs/react": minor
"@aomi-labs/widget": minor
"@aomi-labs/cli": minor
"@aomi-labs/account": patch
---

Open a commit by its ref, without a thread. `aomi.commits.get(ref)` returns a `CommitHandle` with `view`, `review`, `refresh()`, `sign(wallet)` and `reject()`; it talks to `/v1/commits/:ref`, and every write names the version (and, for sign and broadcast, the review digest) the caller reviewed. A missing or foreign ref raises `CommitNotFoundError`; a changed commit raises `CommitStaleError`. `CommitController` accepts the `"ref"` route family, and a version or digest mismatch it detects locally is now a `CommitStaleError` (same message).

Client: new `AomiCommits`, `CommitHandle`, `CommitSigner`, `CommitNotFoundError`, `CommitStaleError`, `COMMIT_REF_ERROR_CODES`, `commitRefPaths`, and the `CommitRefView`, `ThreadOrigin`, `SessionOriginFields` and `CommitRef*Request` wire types.

React: `ThreadMetadata` carries the optional `origin` and `originApp` a server reports for a thread; Telegram threads never enter the thread list.

Widget: `CommitSignPanel` (`./host-composition`) renders the widget's own transaction review for one `CommitHandle` outside any chat, asks for exactly the commit's signer, and shows the settled result with its explorer link. Thread list rows show a small muted icon for chats that started elsewhere (scheduled task, MCP/API, CLI/SDK, or inside an app).

Account: delegated bearer `auth_source` may be `"widget"`; the portal BFF now names widget sessions `widget` and CLI session bearers `cli_session` (portal cookies stay `session`), so the backend records the right commit initiator.

CLI: `aomi tx show <ref>` prints a commit's state, chain, signer, origin, review summary and sign URL.
