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
  - packages/cli/src/commands/release.ts
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

## Releases

- `aomi publish` reads the root `aomi.toml` (`[[packages]] path`,
  `[[agents]] name` and `voice`). For each package folder it runs
  `cargo build --release --target wasm32-wasip2` (skipped by `--no-build`;
  `--wasm <name>=<path>` names the component), tars `aomi.toml`,
  `package.wasm` and the `icon`, `skills` paths and `guards` its `[package]`
  lists, and uploads the tar. It then posts each agent's root text and voice
  file. `--package` and `--agent` select; `--promote` promotes each new
  release with the live number the upload answered.
- `aomi promote <package|agent> <name> <number>`, `aomi rollback <package|agent>
<name> [<number>]` (default: the highest release below live) and
  `aomi releases <package|agent> <name>` read the list first and send its live
  number as `expected_live`.
- They call the Build edge's `/api/build/{packages,agents}/*` (default
  `https://build.aomi.dev`, `AOMI_BUILD_URL`) through `ManagerClient` from
  `@aomi-labs/internal` with a builder API key from `AOMI_BUILDER_KEY` or
  `--key-file`. A refusal prints `code: message` and exits 1.
- `.github/workflows/publish-packages.yml` is the reusable workflow a builder
  repository calls to run `aomi publish --promote` on its runner.

## Output

- One-shot: the reply on stdout, the trace on stderr (one line per step from
  `@aomi-labs/client/trace` `decode`, status glyphs), `--json` NDJSON.
- Exit codes: 0 ok, 1 error, 2 usage, 3 approval, signature or sign-in needed.
- The chat screen is pi-tui (`src/tui/chat.ts`): turns, folded steps, an
  approve box (a/r/o/d), slash commands and a status bar. Esc interrupts.

## Related Topics

- [client-runtime/facts/transport-client.md](../../client-runtime/facts/transport-client.md)
- [development/facts/workspace.md](../../development/facts/workspace.md)
