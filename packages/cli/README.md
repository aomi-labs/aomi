# Aomi CLI

The Aomi agent in your terminal. Install `@aomi-labs/cli` for the `aomi`
command. It is a thin client of `new Aomi()` from `@aomi-labs/client`.

```sh
npm install -g @aomi-labs/cli
aomi                                  # the chat screen
aomi -p "swap 0.1 eth to usdc on base"  # ask once, print the answer
aomi --help                           # every command
```

`aomi <command> --help` lists a command's flags; `--help-all` adds the hidden
ones (`--backend-url`, `--api-key`, `--build-url`).

## Sign in

Two ways, nothing else:

- `aomi login` shows a device code and opens the approval page. Pick the wallet
  or provider there. One approval covers chat, Pipeline and account settings;
  the grant refreshes silently and lives in `~/.aomi/grants.json`.
  `aomi logout` revokes it.
- `--private-key <hex>` (or `AOMI_PRIVATE_KEY`) signs in with SIWE using that
  key, without a browser, and signs what the agent prepares. For agents.
  `--solana-private-key <key>` (or `AOMI_SOLANA_PRIVATE_KEY`, base58 or a
  `solana-keygen` JSON array) does the same with SIWS, on `--cluster`
  (`mainnet`, `devnet` or `testnet`; default the signer's saved cluster, else
  mainnet).

What a local key signs goes out on `--rpc-url`, which is kept for this backend
and chain, else on production's public RPC. Another backend's chains may be
local copies, so there a key sends no EVM transaction, and a Solana one only on
an RPC that knows the block Aomi built it on.

`tx sign`, `tx approve` and `tx reject` show the commit and decide it only when
they show all of it: every call from its bytes, every amount and fee, the full
message, every member of a batch. Anything else, such as a call they can't
decode, an EVM transaction Aomi sends itself (its review has no fee limit) or a
batch a local key would sign, is for the sign page (exit 3). They ask; a script
passes `--yes --version <n>` with the version it reviewed in `tx review --json`.

Without either you are a guest: chat and public reads work, and the guest's
threads stay yours on this machine.

## Output

`aomi -p` writes the reply (and only the reply) to stdout. The trace goes to
stderr, one line per step:

```
✓ Stage transaction     Base · 1 tx · Native transfer · Staged
✓ Simulate transaction  Base · 1 tx
◐ Commit transactions   Base · 1 tx · Awaiting approval

Transfer is ready.

Waiting for you  aomi tx approve 7f3c…
https://aomi.chat/sign/7f3c…
```

`--json` makes stdout NDJSON: `step`, `reply` and `commit` events.

Exit codes: 0 ok, 1 error, 2 usage, 3 waiting for an approval, a signature or a
sign-in, 4 sent but not settled yet.

## Commands

| Command                           | What it does                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chat [message]`                  | Ask once (`-p`) or open the chat screen. `--thread`, `--new`, `--agent`, `--model`                                                                                                   |
| `threads`                         | `list`, `open <id>`, `new`, `rename <id> <title>`, `archive <id>`                                                                                                                    |
| `login`, `logout`, `whoami`       | Sign in and out                                                                                                                                                                      |
| `account`                         | Profile; `connections`, `unlink`, `credits`, `fund`, `statement`                                                                                                                     |
| `wallets`                         | Agent wallets: `list`, `balance <id>`, `use <id>`; the local `signer` (`show`, `set`, `clear`)                                                                                       |
| `rules`                           | Each agent wallet's rules, today's use and waiting change; `approve <change-id>`, `decline <change-id>`                                                                              |
| `tx`                              | `list`, `review <ref>`, `approve <ref>`, `reject <ref>`, `sign <ref>`, `export <ref>`                                                                                                |
| `guard [strict\|balanced\|yolo]`  | The thread's guard, or `--account`'s default                                                                                                                                         |
| `library`                         | `list [--search --chain --tag --on]`, `show <id>`, `on <id>`, `off <id>`, `reset <id>` (each with `--thread`), `add`, `remove <id>`, `connect <id> <slot>`, `disconnect <id> <slot>` |
| `pipeline`                        | `ops`, `op`, `agents`, `packages`, `package`, `invoke`, `stage [--commit]`                                                                                                           |
| `build`                           | Author packages and agents: `init`, `new package\|agent`, `contracts add`, `tool add`, `gen`, `doctor`, `test`, `pack`                                                               |
| `build publish`                   | Build and upload the root `aomi.toml`'s packages and agents. `--promote`, `--package`, `--agent`, `--no-build`, `--wasm name=path`                                                   |
| `build promote`, `build rollback` | `<package\|agent> <name> <number>`: make a release live; rollback names the release to go back to                                                                                    |
| `build codes`                     | `create <package> [--agent <id>]`, `list <package>`, `revoke <package> <id>`: activation codes for a private package                                                                 |
| `build releases`                  | `<package\|agent> <name>`: every release, newest first                                                                                                                               |
| `model`, `chain`                  | `current`, `list`, `set`                                                                                                                                                             |
| `keys`                            | Your own provider keys: `list`, `set <provider>`, `remove`                                                                                                                           |
| `secret`                          | `list`, `add NAME=value…`, `clear`                                                                                                                                                   |
| `config`                          | `current`, `set-backend <url>`                                                                                                                                                       |
| `completion`                      | `eval "$(aomi completion)"`                                                                                                                                                          |

Credential and key values come from stdin or a hidden prompt, never argv.
`--chain` takes a decimal chain id.

## Build and publish packages

`aomi build init <dir> --publisher <slug>` starts a project; each package's
`aomi.toml` points at `aomi.schema.json` for editor checks. `new`,
`contracts add` (from Aomi's registry or `--file`), `tool add` and `gen` write
the files; `doctor` runs publish's checks without building and `test` builds,
packs and checks each package. The `aomi-build` skill in aomi-sdk walks a
coding agent through the loop.

`aomi build publish` builds packages that have a `src/` directory with
`cargo build --release --target wasm32-wasip2`. Text-only packages ship their
manifest and listed files. The CLI uses the platform's optional
`@aomi-labs/build-core-<platform>-<arch>` binary to pack and check each upload,
then publishes the root's agents. For a local build, `AOMI_BUILD_CORE` can point
to the executable. Publishing needs a
builder API key in `AOMI_BUILDER_KEY` (or `--key-file`) holding
`package:publish` and `agent:publish`, plus `package:promote` and
`agent:promote` for `--promote`, `promote`, `rollback` and `codes`. A refusal
prints `code: message` and exits 1. If a `--promote` run fails part way, it
lists the pointers that already moved and how to put each back. A builder repository can run it from CI with the
reusable workflow `aomi-labs/aomi/.github/workflows/publish-packages.yml`.

## The chat screen

`aomi` opens it. Each turn shows "Worked Ns · N steps" (ctrl+o expands the
steps), the reply, and a card for a commit that waits for you: its decoded
steps, what they change, the simulation and whether guards cover it. After a
second, explicit yes `a` approves, `s` signs with the key on this machine and
`r` rejects; `o` opens the sign page, the only key on a card that can't show
everything. A commit that changed meanwhile is shown again, never decided.

Type `/` for `/model` (a list, Auto first), `/guard` (Strict, Balanced or Yolo
for the thread), `/library` (search, turn on or off, show, remove;
`/library add <code>`), `/agent` (pin one for this run, or Auto), `/rpc <url>`,
`/new`, `/help`. `@` tags agents, packages, chains and wallets. The agents are
the one your agent key (`--api-key`) opens. Esc stops a turn; ctrl+c quits.

## State

Everything lives under `~/.aomi` (`AOMI_STATE_DIR` overrides it): `cli.json`
(backend, thread, model, chain, RPCs, local signer keys) and `grants.json`.
`AOMI_BACKEND_URL` or `aomi config set-backend`
point the CLI at another Aomi, e.g. `https://staging.aomi.chat`.
