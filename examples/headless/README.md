# Headless SDK examples

Six small scripts, using Node 24 and the repository-pinned pnpm through Corepack.
Run from the repository root after `pnpm install` and `pnpm build:client`.

```sh
export AOMI_BASE_URL=https://chat-staging.aomi.dev
printf '%s\n' "$AOMI_BASE_URL"  # check the target before every run
pnpm example:agent:guest
pnpm example:agent:oauth
```

The guest route (`POST /api/auth/guest`) may not yet be deployed on staging.
The guest example streams reply text through `AgentRun.session`: the facade's
`Turn.steps()` streams tool calls only. All other scripts use threads and turns.
OAuth prints a verification URL and code and waits up to a minute for approval;
no OAuth client ID is required. Set `AOMI_GRANTS_FILE` to an ignored private file
if you want to persist grants; otherwise they stay in memory.

Generate a fresh, unfunded key for the wallet-authenticated examples:

```sh
export AOMI_PRIVATE_KEY=$(node --input-type=module -e 'import { generatePrivateKey } from "viem/accounts"; console.log(generatePrivateKey())')
printf '%s\n' "$AOMI_BASE_URL"
pnpm example:wallet
printf '%s\n' "$AOMI_BASE_URL"
pnpm example:trace
printf '%s\n' "$AOMI_BASE_URL"
pnpm example:account
```

| Script                | Shows                                                          |
| --------------------- | -------------------------------------------------------------- |
| `example:agent:guest` | Guest auth and one streamed text reply                         |
| `example:agent:oauth` | Device login followed by one turn                              |
| `example:wallet`      | SIWE login, viem signer, Sepolia Commit review, then rejection |
| `example:pipeline`    | Default-app operation build and simulation, without committing |
| `example:trace`       | Tool calls streamed through `@aomi-labs/client/trace`          |
| `example:account`     | Credits, apps, and wallets (reads only)                        |

The wallet script always declines. It does not fund a wallet, sign a transaction,
or broadcast. A model may return advice instead of a Commit; the script reports
how many were produced. SIWE signs a login message only.

The Pipeline example builds and simulates a zero-value Sepolia self-transfer:

```sh
printf '%s\n' "$AOMI_BASE_URL"
pnpm example:pipeline
```

It discovers the default-app catalog and calls `pipeline.build("evm_stage_tx", args)`.
For other operations, inspect their schema with
`aomi.pipeline.app("default").operation(name)`. The SDK fills the required `topic`.
The script never calls `build.commit()`.

```sh
pnpm --filter @aomi-labs/example-headless-client typecheck
pnpm --filter @aomi-labs/example-headless-client test --maxWorkers=4
```

The typecheck includes every TypeScript block in the
[SDK README](../../packages/client/README.md); a test checks they stay in sync.
