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
  `wallet`, `toolset`, `byok`, `account login`, `tx show`) are aliases.
- `aomi` with no command, or root flags such as `-p`, runs `chat`.

## Sign-in

- `aomi login`: one OAuth device grant for the `/v1` resource, stored in
  `~/.aomi/grants.json` by `fileGrants()`. The SDK registers a public device
  client on first sign-in. Wallet and provider choice is on the web page.
- `--private-key` / `AOMI_PRIVATE_KEY`: the SDK's `wallet()` strategy (SIWE)
  and the EVM signer (`viemSigner`).
- Otherwise a guest, whose bearer is kept in `~/.aomi/cli.json`.

## Packages

- `aomi library` (`src/commands/packages.ts`) drives `aomi.account.packages`
  on `/api/account/packages`. `list [--thread <id>]` prints each package as
  `publisher/name`, on or off with the reason, verified, families and missing
  slots. A package is named by `publisher/name` or its numeric id.
- `on <id>` prints the live envelope's notice (hosts, transaction families,
  signatures) and asks to confirm unless `--yes`; outside a terminal it needs
  `--yes`. `off <id>` on an agent-listed package prints the reason and exits 1
  without calling the backend. `reset <id>` clears the choice.
- `connect <id> <slot>` reads the value from stdin or a hidden prompt, never
  an argument, and never prints it; `disconnect <id> <slot>` clears it.
- Device sign-in asks for `account:packages:read` and `account:packages:write`.

## Releases

- Every author command is under `aomi build` (`src/commands/build.ts`,
  `release.ts`). Anything about a package or agent runs in `aomi-build-core`
  (`AOMI_BUILD_CORE`, or the platform's optional dependency): `init`,
  `new package|agent`, `contracts add` (the CLI fetches a registry lookup
  through the pipeline's `evm_get_contract`/`svm_get_program`), `tool add`,
  `gen`, `doctor`, and `manifest`, which lists the root's packages and agents.
- `aomi build test`, `pack` and `publish` build each package folder with
  `cargo build --release --target wasm32-wasip2` unless it is text-only
  (`--no-build`; `--wasm <name>=<path>` names the component), then pack and
  check it with the core. `publish` uploads the bundle, then posts each
  agent's root text and voice file. `--package` and `--agent` select;
  `--promote` promotes each new release with the live number the upload
  answered.
- `aomi build promote|rollback <package|agent> <name> <number>` (rollback
  always names its release) and `aomi build releases <package|agent> <name>`
  read the list first and send its live number as `expected_live`.
- They call the Build edge's `/api/build/{packages,agents}/*` (default
  `https://build.aomi.dev`, `AOMI_BUILD_URL`) through `ManagerClient` from
  `@aomi-labs/internal` with a builder API key from `AOMI_BUILDER_KEY` or
  `--key-file`. A refusal prints `code: message` and exits 1.
- `.github/workflows/publish-packages.yml` is the reusable workflow a builder
  repository calls to run `aomi build publish --promote` on its runner.

## Output

- One-shot: the reply on stdout, the trace on stderr (one line per step from
  `@aomi-labs/client/trace` `decode`, status glyphs), `--json` NDJSON.
- Exit codes: 0 ok, 1 error, 2 usage, 3 approval, signature or sign-in needed.
- The chat screen is pi-tui (`src/tui/chat.ts`): turns, folded steps, an
  approve box (a/r/o/d), slash commands and a status bar. Esc interrupts.

## Related Topics

- [client-runtime/facts/transport-client.md](../../client-runtime/facts/transport-client.md)
- [development/facts/workspace.md](../../development/facts/workspace.md)
