---
title: CLI
owner: sdk
status: authoritative
area: client-runtime
review_after_days: 30
sources_of_truth:
  - packages/client/package.json
  - packages/client/src/cli/main.ts
  - packages/client/src/cli/root.ts
  - packages/client/src/cli/repl.ts
  - packages/client/src/cli/commands/chat.ts
---

# CLI

The `aomi` terminal client is published from `@aomi-labs/client` and shares its transport layer with the widget runtime.

## Entrypoint

- `packages/client/package.json` exposes the `aomi` bin as `./dist/cli.js`.
- `packages/client/src/cli/main.ts` decides whether to run root help, one-shot commands, or the interactive REPL.
- Root command handling is defined under `packages/client/src/cli/root.ts`.

## Command Surface

- The CLI supports chat, transaction, session, model, app, chain, wallet, config, and secret commands.
- Transaction commands include `tx list`, `tx simulate <id>...`, `tx export <id>...`, and `tx sign <id>...`.
- `tx export` refreshes authoritative pending state and emits a wallet handoff artifact to stdout. The default `eip5792` format is the full EIP-5792 `wallet_sendCalls` version `2.0.0` parameter object; `moss` emits its ordered call array, and `metamask` emits a decimal chain ID plus exactly one raw transaction payload. It accepts EVM transaction calls on one sender and chain; it never signs, broadcasts, injects the execution-time service-fee call, or reports completion to the backend.
- Interactive mode exposes slash-style helpers such as `/app`, `/model`, and `/key`.
- The root help path is intentionally explicit about backend URL, API key, app, model, chain, and wallet options.

## OAuth account session

- `aomi account login` dynamically registers a public PKCE client, obtains
  Agent and Pipeline device grants, opens the shared portal approval page, and
  polls the Better Auth device endpoint using the server-provided interval.
- The state file keeps access/refresh expiry and exact resource/scope binding.
  Refresh rotation is serialized and replaced atomically; logout calls the
  official revocation endpoint before clearing local grants.
- `--legacy` retains the old account-session ceremony during the measured
  compatibility window. `AOMI_CLI_OAUTH_DEFAULT_ENABLED` reverses the default
  without changing server issuance or REST/MCP routing.

## Role In The Repo

- The CLI is the terminal-facing consumer of the same backend contracts used by the runtime and widget.
- Packaging it inside `@aomi-labs/client` keeps the command surface and transport layer versioned together.

## Related Topics

- [client-runtime/facts/transport-client.md](../../client-runtime/facts/transport-client.md)
- [development/facts/workspace.md](../../development/facts/workspace.md)
