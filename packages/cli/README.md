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
ones (`--backend-url`, `--api-key`, `--rpc-url`, `--solana-private-key`).

## Sign in

Two ways, nothing else:

- `aomi login` shows a device code and opens the approval page. Pick the wallet
  or provider there. One approval covers chat, Pipeline and account settings;
  the grant refreshes silently and lives in `~/.aomi/grants.json`.
  `aomi logout` revokes it.
- `--private-key <hex>` (or `AOMI_PRIVATE_KEY`) signs in with SIWE using that
  key, without a browser, and signs what the agent prepares. For bots.

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
https://chat.aomi.dev/sign/7f3c…
```

`--json` makes stdout NDJSON: `step`, `reply` and `commit` events.

Exit codes: 0 ok, 1 error, 2 usage, 3 waiting for an approval, a signature or a
sign-in.

## Commands

| Command | What it does |
| --- | --- |
| `chat [message]` | Ask once (`-p`) or open the chat screen. `--thread`, `--new`, `--app`, `--model` |
| `threads` (`session`) | `list`, `open <id>`, `new`, `rename <id> <title>`, `archive <id>` |
| `login`, `logout`, `whoami` | Sign in and out |
| `account` | Profile; `connections`, `unlink`, `credits`, `fund`, `statement` |
| `wallets` (`wallet`) | Agent wallets: `list`, `balance <id>`, `use <id>`; the local `signer` (`show`, `set`, `clear`) |
| `tx` | `list`, `review <ref>`, `approve <ref>`, `reject <ref>`, `sign <ref>`, `export <ref>` |
| `guard [mode]` | The thread's signing guard, or `--account`'s default |
| `apps` (`app`) | `list`, `install`, `uninstall`, `use`, `credentials` |
| `pipeline` | `ops`, `op`, `apps`, `skills`, `skill`, `invoke`, `build [--commit]` |
| `deploy` | Deploy the current commit; `status [--watch]`, `activate` |
| `model`, `chain` | `current`, `list`, `set` |
| `keys` (`byok`) | Your own provider keys: `list`, `set <provider>`, `remove` |
| `secret` | `list`, `add NAME=value…`, `clear` |
| `config` | `current`, `set-backend <url>` |
| `completion` | `eval "$(aomi completion)"` |

Credential and key values come from stdin or a hidden prompt, never argv.
`--chain` takes a decimal chain id.

## The chat screen

`aomi` opens it. Each turn shows "Worked Ns · N steps" (ctrl+o expands the
steps), the reply, and a box for a commit waiting for your approval: `a`
approve, `r` reject, `o` open in the browser, `d` details. Type `/` for
`/model`, `/mode`, `/new`, `/help`. Esc stops a turn; ctrl+c quits.

## State

Everything lives under `~/.aomi` (`AOMI_STATE_DIR` overrides it): `cli.json`
(backend, thread, model, app, chain, local signer keys) and `grants.json`.
The first run reads a 0.2 session once; an old wallet or bearer sign-in asks
you to `aomi login` again. `AOMI_BACKEND_URL` or `aomi config set-backend`
point the CLI at another Aomi, e.g. `https://chat-staging.aomi.dev`.
