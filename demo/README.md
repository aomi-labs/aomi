# Demo studio

Records repeatable product demo videos against a forked mainnet, so demos stop
being an afternoon of retakes and start being a build artifact.

Design and scenario catalog: [`docs/specs/DEMO-STUDIO.md`](../docs/specs/DEMO-STUDIO.md),
[`docs/specs/DEMO-SCENARIOS.md`](../docs/specs/DEMO-SCENARIOS.md).

**Status: the pipeline is proven; most scenarios are not.** Takes 13/14
(2026-07-31) recorded `ds2-stake-eth` end-to-end — agent staked 5 ETH into Lido
on a mainnet fork, verified on-chain (5.0 stETH), real tx hash on screen,
`execution_kind: e2e_real_fork_call`. That proves fork → backend → portal →
capture works. Every other scenario is draft; see the status table below before
promising anyone a video.

## How it fits together

| Layer | Where | Status |
| --- | --- | --- |
| Fork lifecycle + pre-funding | `aomi-cli test-env evm` in **product-mono** | exists, we only call it |
| Backend, catalog-scoped | product-mono backend + `LOCAL_SCOPED_APPS` (branch `fix/test-db-guard-and-artifact-breaker`, not yet in main) | proven |
| Chain routing in the UI | `NEXT_PUBLIC_USE_FULL_TESTNET` + widget-lib helpers | wired into the portal |
| E2E wallet + fork executor | `apps/portal/src/server/e2e-wallet.ts` | proven |
| Scenarios | `demo/scenarios/*.scenario.ts` | 1 proven, rest draft — see below |
| Capture | `demo/capture/record.ts` | proven |

The UI keeps the **real** chain ids and only swaps the RPC url, so a recording
shows "Ethereum · Mainnet" while every transaction lands on a local fork.

## Scenario status

Only claim a scenario works if it is listed **proven** here. A scenario file
existing means the prompt and expectations are written down, not that a take has
ever completed.

| Scenario | Status |
| --- | --- |
| `ds2-stake-eth` | **proven** — takes 13/14, 5.0 stETH verified on-chain |
| `money-legos-stake-collateralize` | draft — agent found wstETH unprompted and simulated all 6 txs, but commit is blocked by the staged-tx-loss bug |
| `stake-shootout` | draft — blocked by the multi-skill guard bug (comparing pools activates 3 staking skills, whose guards then reject each other) |
| `aave-borrow-against-usdc` | draft — never run |
| `ds4-bridge-to-base` | draft — source leg only by design; L2 arrival needs the real sequencer |
| `ds6-sol-swap-stake` | draft — owned by the Solana track |

### What cannot be recorded at all

Anything that depends on an **off-chain service** cannot be forked, which rules
out most of the original catalog: Polymarket (live matching engine), 0x gasless
(relayer submits to real mainnet), CEX venues (fills happen at the exchange),
and bridges via Across/LI.FI (filler relayers watch real chains). Only pure
on-chain contract calls are fork-native. Do not write a scenario for these
expecting the studio to record it.

## What a take proves — and what it does not

Read this before captioning a video or answering a partner's question about it.

**Real in every take:** the agent's reasoning and tool calls, the backend, the
skills and their guards, simulation, the signing-authorization permit, the
staged transaction, the broadcast, and the resulting chain state. When a take
says 5 ETH became 5.0 stETH, that happened on a real Lido contract.

**A double in every take: the wallet provider.** The recording wallet is the
portal's E2E executor — `viem`'s `privateKeyToAccount` (EVM),
`@solana/web3.js` + `tweetnacl` (SVM), and an HMAC session cookie. It contains
**no Para code at all**: the repo's eight `@getpara/*` packages and the
`providers/para/` plugin (auth, embedded wallet, message signing) are not on
the recording path.

So a take does **not** prove the production wallet stack works. If asked "is
this your real wallet integration?", the honest answer is: everything from the
agent down to the chain is real; the wallet layer is a test double.

### The "Para" badge in the account chip is not earned

The E2E identity object hardcodes `walletProvider: "para"` (plus
`authValue: "e2e@aomi.dev"`) so the UI renders the same chrome as a real
session — which means **the account chip in current recordings reads
"0x3C44…93BC · Para" for a wallet with no Para in it.** Harmless internally;
not something to put in front of a partner, least of all Para. Either relabel
the stub (`walletProvider: "e2e"`, one line — the chip loses its brand) or wire
the real Para provider into the demo portal so the badge is earned. Until one
of those happens, keep the chip out of frame or out of the claim.

### Why no wallet popup appears

This question comes up every time someone watches a take. The demo wallet is in
**`client_auto`** signing mode, one of three backend lanes:

| Mode | Who signs | On camera |
| --- | --- | --- |
| `manual` | the human, in real time (request routes to the FE) | approval UI |
| `auto` | the server, via a delegated provider grant | nothing |
| `client_auto` ← demos | a key-holding caller at the edge, unattended | nothing |

The wallet earned that mode through the **permit ceremony** (challenge → wallet
signs → commit, once for `bind`, once for `client_auto`) — off camera, before
recording. That ceremony *is* the wallet signature; it is the same grant a real
power user opts into.

Note what the browser does and does not hold: it carries only the HMAC session
cookie (an address and a cluster). The key is a server-only env var and the
signing code sits behind `import "server-only"`, so it cannot reach the client
bundle. In production `client_auto`, the edge signer often genuinely *is* the
browser (Para MPC/passkey); the studio moves it server-side so no key material
is ever near a screen recording.

**Caption guidance:** say "pre-authorized agent wallet", never "no approval
needed". A security reviewer will ask, and the permit answer lands well while
the other one does not.

## Runbook — verified 2026-07-31

Every step below was exercised on real takes. Paths assume `~/Code/product-mono`
and this repo side by side.

### 0. One-time prerequisites

- Build the CLI and backend from product-mono source (the homebrew `aomi` has
  **no** `test-env` command group):

  ```bash
  cd ~/Code/product-mono/aomi && cargo build -j2 --bin aomi-cli --bin backend
  ```

- `service.toml` must exist in the backend's cwd (`aomi/`), and it must trust
  the kid the portal actually signs with. A locally-run portal mints bearers
  with kid **`aomi-bff-dev-1`**; the checked-in staging trust records only list
  `aomi-bff-staging-1` (same keypair, different label — verification fails on
  the kid lookup). Fix once: duplicate the `[[trusted_issuers]] name="aomi-bff"`
  block in the gitignored `service.toml` with `kid = "aomi-bff-dev-1"`.

- The demo wallet is **anvil dev account 2** (`0x3C44…93BC`) — account 0 is
  permanently bound to another user in the shared DB. Account 2 must be bound
  to the demo account with `client_auto` signing (already done for
  `E2E_STUB_CANONICAL_USER_ID=8641fa7c-…`; redo only for a new account):
  challenge → `cast wallet sign --data <typed_data>` → commit, once with
  `mode=bind`, once with `mode=client_auto`, against
  `/api/account/authorization/{challenge,commit}`.

### 1. Fork up

```bash
cd ~/Code/product-mono
FULL_TESTNETS=true PROVIDERS_TOML=~/Code/product-mono/providers.toml \
  ./aomi/target/debug/aomi-cli test-env evm up --chains 1
```

`PROVIDERS_TOML` is required — discovery walks the *cwd's* ancestors, so it
fails from this repo. **The port is random on every `up`** — read it:

```bash
python3 -c "import json;print(json.load(open('$HOME/.aomi/test-env/pids.json'))['proxies'][0]['port'])"
```

Proxies die easily. Two causes seen repeatedly:

- **Memory pressure.** The proxy is what the OS kills first. A take needs fork +
  backend + portal + Chromium at once; with an IDE, a language server and a
  `cargo build` also running, free RAM hit 154 MB and the fork died mid-take
  more than once. Close heavy apps before a recording session.
- Tool-call process-group cleanup, or another session running `kill-all.sh`.

If takes start failing `assertForkedOrDie`, re-up and re-read the port.

> **Every fork restart requires a backend restart.** The backend resolves fork
> endpoints from `PROVIDERS_TOML` **at boot** and caches them. Since `up` picks
> a new random port each time, a backend started against the previous fork will
> silently talk to a dead proxy — the symptom is the agent replying "I was
> unable to retrieve your account information … connection issue with the
> network provider", which looks like an agent failure and is not. Order is
> always: fork up → portal env → **backend restart** → record.

### 2. Backend, scoped

```bash
cd ~/Code/product-mono/aomi
LOCAL_SCOPED_APPS="demo-studio-none" \
OFFICIAL_GITHUB_TOKEN="$(gh auth token)" \
FULL_TESTNETS=true \
PROVIDERS_TOML=$HOME/.aomi/test-env/providers.toml \
  ./target/debug/backend
```

- `PROVIDERS_TOML` now points at the **derived** file test-env wrote — that is
  what routes the backend's chain reads/writes to the fork.
- `LOCAL_SCOPED_APPS` = union of `scenario.apps`; `demo-studio-none` is the sentinel
  for skills-only scenarios (scope only activates when non-empty). Scoped run:
  boot log is ~1 line instead of ~17k fetch errors, and the host never writes
  the shared `applications` table.
- Needs `SUPABASE_DB_URL` (or `DATABASE_URL`) in the environment — the backend
  refuses to boot without one.

### 3. Portal env

`apps/portal/.env.local` needs, on top of a normal local config:

```bash
NEXT_PUBLIC_BACKEND_URL="http://127.0.0.1:8080"     # hosted backends can NEVER see the fork
BACKEND_URL="http://127.0.0.1:8080"
NEXT_PUBLIC_USE_FULL_TESTNET="true"
NEXT_PUBLIC_FULL_TESTNET_RPC_MAP='{"1":"http://127.0.0.1:<FORK_PORT>"}'
AOMI_ENABLE_E2E_WALLET="true"
AOMI_E2E_WALLET_TOKEN="demo-studio-local"
AOMI_E2E_EXECUTION_MODE="real"
NEXT_PUBLIC_AOMI_E2E_EXECUTION_MODE="real"          # client checks THIS one
AOMI_E2E_SIGNER_PRIVATE_KEY="<anvil account 2 key>"
AOMI_E2E_RPC_URL_1="http://127.0.0.1:<FORK_PORT>"
E2E_STUB_CANONICAL_USER_ID="<users.id to bill/attribute the session to>"
AOMI_E2E_MAX_NATIVE_WEI="6000000000000000000"       # 6 ETH cap for a 5 ETH stake
# VERCEL_ENV must be UNSET — isE2EWalletEnabled() refuses otherwise.
```

Gotchas, each of which cost a take:

- **Update both `<FORK_PORT>` occurrences on every fork re-up** — and never
  regex-replace all `127.0.0.1:\d+` in the file, that clobbers the backend URL.
- **Turbopack caches inlined `NEXT_PUBLIC_*` values across restarts.** After
  changing one: `rm -rf apps/portal/.next-demo-studio`, then restart the portal.

Start the portal (`.claude/launch.json` has `portal-demo-studio`, port 3500,
isolated dist dir).

### 4. Record

```bash
PORTAL_URL=http://localhost:3500 \
AOMI_E2E_WALLET_TOKEN=demo-studio-local \
AOMI_E2E_ADDRESS=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
AOMI_BIN=$HOME/Code/product-mono/aomi/target/debug/aomi-cli \
PROVIDERS_TOML=$HOME/Code/product-mono/providers.toml \
FULL_TESTNETS=true \
  pnpm exec tsx demo/capture/record.ts ds2-stake-eth
```

What a run does, in order: reads the fork from `pids.json` →
`assertForkedOrDie` (anvil probe; refuses real RPCs) → `test-env evm reset`
per scenario chain (identical state every take) → funds `AOMI_E2E_ADDRESS`
with 10 ETH **after** the reset (reset reforks and wipes balances) → seeds the
E2E wallet cookie → dismisses the consent banner (repeatably — it mounts
lazily) → types each `prompts[]` entry at human cadence, verifying the typed
text (hydration eats first keystrokes) → waits on the streaming indicator, only
ever on real UI state → settle-waits for follow-up turns (execution callbacks
trigger one more agent turn; without this the video cuts mid-confirmation) →
if `expectsExecution`, polls up to 30s for the fork to mine a block and FAILS
the take if it didn't.

Output: `demo/out/<scenario-id>/` — master `.webm` + `markers.json`. Convert:

```bash
ffmpeg -i demo/out/ds2-stake-eth/*.webm -c:v libx264 -crf 20 -pix_fmt yuv420p \
  -movflags +faststart demo/out/ds2-stake-eth/ds2-stake-eth-master.mp4
```

Short cuts are derived from the markers — **do not re-shoot per format.**

### 5. Teardown

```bash
FULL_TESTNETS=true ./aomi/target/debug/aomi-cli test-env evm down
pkill -f "target/debug/backend"
```

## Solana takes

The Solana leg records against the Surfpool mainnet-fork mirror:

```bash
FULL_TESTNETS=true aomi-cli test-env svm up --cluster mainnet-beta
```

**Funding is NOT declarative, despite appearances.** The operator
`providers.toml` carries a `[surfpool.mainnet-beta]` section with airdrops and
`token_fixtures`, and it is tempting to assume `test-env svm reset` re-applies
them. Measured 2026-08-01: it does not. It does not even restart Surfpool —
the process had been up 3h57m across a dozen resets. A take that spends SOL
therefore starts from the *previous take's* leftovers unless the studio writes
the balances itself.

So scenarios declare their entire starting state and the recorder writes it
after every reset:

- `svm.fund.sol` → `surfnet_setAccount` (the `anvil_setBalance` analog)
- `svm.tokenAccounts[]` → `surfnet_setTokenAccount`

The first DS6 take started from 7.5 leftover SOL instead of 10 and still
passed, because its assertions were loose enough to straddle both. Declare the
start, then make the bounds tight enough to notice.

**Do not seed an empty (`amount: "0"`) ATA as a "harmless" placeholder.** It
is not harmless. The agent reads a zero balance, cannot tell an empty account
from a missing one, and tries to create it — which `svm-manifest-guard` blocks
on any backend built before #912. It then loops on "Correcting Marinade stake
account" until the take times out, having executed nothing. Three consecutive
takes died this way. Seed dust (`"1000000"`) instead, or rebuild the backend
past #912 and drop the fixture.

One-time wallet authorization (bind + client_auto ceremonies):

```bash
pnpm exec tsx demo/capture/authorize-svm.mts --keypair ~/.aomi/test-env/svm/demo-mainnet-fork.json --pubkey <base58>
```

Recorder env: `AOMI_E2E_SVM_ADDRESS=<base58>`; portal env additionally needs
`AOMI_E2E_SOLANA_KEYPAIR_PATH`, `AOMI_E2E_SOLANA_RPC_URL=<mirror>` and
`NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL=<mirror>`; backend needs
`SOLANA_MAINNET_RPC_URL=<mirror>`.

Execution proof differs per VM, deliberately: anvil only mines on
transactions, so EVM uses block advance; Surfpool mints slots on a clock, so
Solana takes declare `svm.verify` balance assertions instead — a take that
moved no balances fails, no matter how good it looked.

### Two failure modes that produce a *plausible* bad video

Both were found shooting DS6, and both pass every automated check the studio
had at the time. They are the reason a human still watches the take.

**1. The agent apologises for succeeding.** A turn that stops streaming has
not necessarily finished — execution callbacks land afterwards and trigger one
more agent turn. DS6 take 2 typed its approval 1.6s into that gap; the agent
had no confirmation hash yet, so it re-staged an already-executed leg, read
back the (correctly) spent balance, and closed with *"your current balance is
~0.0099 SOL … not enough"* while the chain showed a perfect swap and stake.
Chain assertions all passed. The video was unusable.

The recorder now settles after **every** turn, not just at the end of the
take. Expect a ~9s gap before a follow-up prompt; that gap is the fix.

Related, and worth wording carefully in the scenario: an approval prompt
should say *"Yes, approve the stake"*, not *"go ahead and execute both"* — the
latter reads as an instruction to redo the swap.

**2. Bundle construction is not deterministic.** The agent does not build the
same instruction bundle twice. One DS6 take simulated 8 transactions clean and
executed; the next built 9, failed simulation, and looped on repair until
timeout. Roughly two runs in five ended that way before the ATA fix.

So a take is an **attempt**. `RECORD_ATTEMPTS` (default 3) re-seeds state and
re-shoots until one passes; videos from failed attempts are deleted, so the
output dir holds exactly the take that passed. Keep `timeoutMs` tight — it is
the per-attempt cost of a failure, not a safety margin.

### Camera hygiene

Handled by the recorder, listed here because each one shipped in a take before
it was noticed:

- **Cookie banner** — pre-seeded to `declined` in `localStorage` before first
  paint. Clicking Decline mid-take is too late; it mounts lazily and sat over
  the composer for a whole turn.
- **Next dev indicator** — a badge in the bottom-left, directly on top of the
  account chip, reading as *"this product has N issues"*. Disabled via
  `AOMI_HIDE_DEV_INDICATOR=true` (wired into the `portal-demo-studio` launch
  config); the CSS-injection approach is not reliable enough to depend on.
- **Thread sidebar** — collapsed by clicking its trigger, then *verified*
  collapsed via `data-state`. A blind click is not enough. Left open, the
  frame shows prior debug threads, one of which is titled "Lido ETH Staking
  Testnet Fail".

## The safety rails, and why they are there

Full-testnet routing **fails open**: with the env missing, the portal silently
uses real mainnet RPCs and a money-spending take would look successful. The
independent guards, none of which should be downgraded:

1. `assertForkedOrDie()` — `anvil_nodeInfo` probe on every endpoint before
   recording; only anvil answers it.
2. `forkProgress()` — block height before/after; an `expectsExecution` take
   fails if the chain didn't move. (Replaced an earlier browser-traffic watch,
   which was wrong: agent tools execute server-side, the page never contacts
   the fork.)
3. Server-side, `e2e-wallet.ts` allows contract calls **only when the RPC
   answers `anvil_nodeInfo`** (fails closed); on real RPCs the executor stays
   self-transfer-only with a dust cap. Covered by tests in
   `e2e-wallet.test.ts`.

## Known gaps / caveats

- The recorder stubs `POST /api/exec/simulate` (FE bug: the browser sends an
  empty body; fee injection 400s and the wallet request dies). Remove the
  WORKAROUND block in `record.ts` once the client fix lands.
- Takes create **real threads** on the canonical user's account in the shared
  DB — archive them before partner-facing takes; the sidebar is on camera.
- Raw `wallet:tx_complete` JSON renders as a chat bubble, and the agent's
  "please approve" can land *after* auto-execution confirms — both are product
  UI polish items on the demo path.
- Solana: `test-env svm` (Surfpool mirror) exists but is unverified against
  Jupiter/Marinade; byreal's off-chain orderbook can't be forked at all.
- `aomi tx sign` prints the **fee** transfer hash, not the protocol tx hash —
  never present it as the swap.
