# Command reference

## Availability

Install `@aomi-labs/cli@latest` for the terminal command. `@aomi-labs/client`
is the TypeScript SDK; its old CLI entry prints migration instructions.
The separate CLI version history restarted at 0.1.x. Require CLI `0.2.0` or
newer, verified from public npm on October 30, 2026 with SDK `0.11.2`.

```sh
npm install -g @aomi-labs/cli@latest
aomi --version
aomi tx --help
aomi tx export --help
aomi tx submit --help
aomi tx preflight --help
```

For one-shot use, substitute `npx @aomi-labs/cli@latest` for `aomi`. Check both
the version and capabilities: an old embedded-client executable can have a
numerically higher version. Installing a skill does not update a global binary.

## Commit and payment commands

```sh
aomi config current --json
aomi wallet current --json
aomi session list
aomi session resume <local-session-id>
aomi tx preflight <intent-file>
aomi chat "<intent>" --new-session --public-key <sender> --chain <chain-id>
aomi tx list --json
aomi tx export <commit-id> --format commit > reviewed-commit.json
aomi tx sign <commit-id>
aomi tx submit <commit-id> --signed-file <signed-export-file>
aomi tx submit <commit-id> --tx-hash <prepared-broadcast-hash>
```

Preflight is read-only on chain and never signs.
A full Commit ID identifies the durable payment. An external signed file uses
`aomi.commit.v1`, the unchanged exact exported Commit, and a top-level `payloads`
array. `--tx-hash` reports the exact prepared broadcast hash; it is not a general
way to attach arbitrary transactions.

`tx list` can contain both Commits and legacy Actions. `tx simulate` accepts
legacy EVM Action IDs; consult the current help only if that branch is needed.
A Commit's simulation evidence is already in its durable review.

## Transport and signing

| Setting | Meaning |
| --- | --- |
| `--backend-url` / `AOMI_BACKEND_URL` | Portal/BFF origin, production `https://chat.aomi.dev`, staging `https://chat-staging.aomi.dev` |
| `--public-key` | Intended sender context, not authorization or proof of funding |
| `--chain` | Explicit session chain ID |
| `--rpc-url` / `CHAIN_RPC_URL` | Signing RPC, must match the prepared transaction's chain |
| `--account-bearer` / `AOMI_ACCOUNT_BEARER` | Account authorization, never print its value |
| `AOMI_STATE_DIR` | Local CLI state directory, default `~/.aomi` |

`config current --json` reports a sanitized origin and its source (flag, env,
saved session, default). Environment overrides take precedence over saved
configuration. The direct backend `api.aomi.dev` / `api-staging.aomi.dev` does
not serve Portal guest login. Correct only the CLI's override when other tools
still need a direct backend URL.

Signing configuration belongs to the designated signer. Inspect the live
command help for EOA/AA/Solana flags, then match the exported Commit payload.
The separate Rust `aomi-cli` interface is not interchangeable with these commands.
