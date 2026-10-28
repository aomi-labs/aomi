---
title: CLI
owner: sdk
status: authoritative
area: client-runtime
review_after_days: 30
sources_of_truth:
  - packages/cli/package.json
  - packages/cli/src/app.ts
  - packages/cli/src/context.ts
  - packages/cli/src/tui/chat.ts
---

# CLI

The `aomi` terminal client is published from `@aomi-labs/cli`. It is a thin
client of `new Aomi()` from `@aomi-labs/client`: no transport, auth or signer
code of its own.

## Entrypoint

- `packages/cli/package.json` exposes the `aomi` bin as `./dist/bin.js`.
- `packages/cli/src/app.ts` is the Stricli route table. Root `--help` prints
  it in groups with aliases; flags are scoped to the commands that use them
  and internal ones show only under `--help-all`. Old paths (`session`,
  `wallet`, `app`, `byok`, `account login`, `tx show`) are aliases.
- `aomi` with no command, or root flags such as `-p`, runs `chat`.

## Sign-in

- `aomi login`: one OAuth device grant for the `/v1` resource, stored in
  `~/.aomi/grants.json` by `fileGrants()`. The SDK registers a public device
  client on first sign-in. Wallet and provider choice is on the web page.
- `--private-key` / `AOMI_PRIVATE_KEY`: the SDK's `wallet()` strategy (SIWE)
  and the EVM signer (`viemSigner`).
- Otherwise a guest, whose bearer is kept in `~/.aomi/cli.json`.

## Output

- One-shot: the reply on stdout, the trace on stderr (one line per step from
  `@aomi-labs/client/trace` `decode`, status glyphs), `--json` NDJSON.
- Exit codes: 0 ok, 1 error, 2 usage, 3 approval, signature or sign-in needed.
- The chat screen is pi-tui (`src/tui/chat.ts`): turns, folded steps, an
  approve box (a/r/o/d), slash commands and a status bar. Esc interrupts.

## Related Topics

- [client-runtime/facts/transport-client.md](../../client-runtime/facts/transport-client.md)
- [development/facts/workspace.md](../../development/facts/workspace.md)
