# Solana demo replication plan

Status: PLAN — nothing implemented. Written 2026-07-31 after the first
successful EVM recording (DS2, `demo/out/ds2-stake-eth`). Target: scenario 6 of
`DEMO-SCENARIOS.md` — "Swap 5 SOL for USDC, then stake the rest" — recorded on a
local mainnet fork with the same guarantees as the EVM take: deterministic,
free, re-recordable, execution verified on-chain, no secrets on camera.

**This plan supersedes the "Solana cannot run on a fork" note in
`DEMO-SCENARIOS.md` scenario 6** — that was written before reading the SVM
test-env source. The fork exists; what remains is wiring and one real unknown
(Jupiter).

## What already exists (verified against source today)

The Solana story is further along than the EVM one was when we started:

| Piece | Where | State |
| --- | --- | --- |
| Local mainnet fork | `aomi test-env svm up` → Surfpool, `Cluster::MainnetBeta` sources from mainnet RPC (`test_env/svm/state.rs:316`) | exists |
| SOL funding | startup airdrops (`svm/mod.rs`) | exists |
| **USDC funding** | declarative `[[surfpool.<cluster>.token_fixtures]]` → surfnet-native cheat-RPC `surfnet_setTokenAccount`, with a `"usdc"` mint alias (`svm/fixtures.rs`) | exists — better than EVM, where we hand-rolled whale impersonation |
| Reset between takes | `aomi test-env svm reset --cluster <c>` | exists |
| Generated provider | `state::write_generated_provider(cluster, endpoint)` | exists |
| E2E Solana wallet | portal `e2e-wallet.ts`: seed carries `svmAddress`+`svmCluster`; executor does sign / sign-and-send / sign-message with `AOMI_E2E_SOLANA_SIGNER_PRIVATE_KEY` / keypair path | exists |
| **Safety boundary** | `loopbackSolanaRpcUrl()` — the SVM executor refuses ANY non-loopback RPC | exists, and stricter than my EVM `anvil_nodeInfo` gate |
| Permit ceremony (SVM) | challenge `chain_type: "svm"` → Ed25519 over `message_base64` → commit with `signer`; modes incl. `client_auto` | exists |
| Apps | `jupiter.dylib`, `marinade.dylib`, `svm_transfer.dylib` in `~/Code/aomi-sdk/plugins` | built locally |
| FE network routing | portal `solanaNetworks` RPC URLs are env-driven (`NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL`) | exists — no code change |

## The gaps, in implementation order

### 1. Portal: `solana:mainnet` E2E cluster (small, the only real code change)

`E2ESvmCluster = "solana:devnet" | "solana:testnet"` — no mainnet. The mirror
forks mainnet-beta, so the agent's payloads will carry a mainnet cluster and the
seed/payload match check (`normalizeE2ESvmCluster(payload.cluster) !==
seed.svmCluster`) rejects them.

Extend the union with `"solana:mainnet"` across: the type, `parseE2ESvmCluster`,
`normalizeE2ESvmCluster` (accept `mainnet` / `mainnet-beta` /
`solana:mainnet`), cookie verify, and the seed route. **This is safe by
construction**: the executor's loopback-only rule means a mainnet-cluster seed
can still only ever sign against `127.0.0.1` — same posture as the EVM
fork-verified policy, enforced harder. Add tests mirroring the EVM fork-gate
trio (loopback refusal already has one).

### 2. Backend + portal wiring (env only, no code)

- Backend: point Solana mainnet resolution at the mirror. Resolution order (per
  `providers.toml` comment): `[solana.mainnet].rpc_url` (empty on purpose) →
  `SOLANA_MAINNET_RPC_URL` env. Launch with that env set to the mirror
  endpoint, alongside the existing `AOMI_APPS_ONLY="jupiter,marinade"`.
- Portal env: `NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL=<mirror>`,
  `AOMI_E2E_SOLANA_RPC_URL=<mirror>` (must be loopback — it is), fresh demo
  keypair via `AOMI_E2E_SOLANA_SIGNER_PRIVATE_KEY`.

### 3. Demo wallet identity (no DB surgery — learned from EVM)

Generate a **fresh** Ed25519 keypair (the EVM lesson: never reuse a bound
address; Cecilia's real Solana key `58ti…Rc8L` is `mode=manual` and must stay
that way). Then the same two curl ceremonies as EVM, SVM flavor: challenge
`mode=bind` → sign `message_base64` (tweetnacl or `solana sign-offchain`) →
commit; repeat with `mode=client_auto`. Revoke both bindings when demos wrap,
same as the EVM account-2 note.

### 4. Recorder generalization (`demo/capture/`)

- **Scenario shape**: `chains: number[]` is EVM-only. Add an `svm?: { cluster:
  "mainnet-beta" }` block (coordinate with the parallel session — types.ts just
  grew an `erc20` field, the rig is being extended concurrently).
- **Reset/fund**: `test-env svm reset` between takes; funding is declarative
  (fixtures) so unlike EVM there is no post-reset seeding race — fixtures
  re-apply on boot; verify reset re-applies them (first-run check).
- **Execution proof — the important design change**: slot advance is NOT proof
  on Surfpool (a validator mints slots on a clock, transactions or not), so
  `forkProgress`'s block-delta heuristic is meaningless here. Replace with
  declarative balance assertions on the scenario:
  `verify: [{ kind: "spl", mint: "usdc", atLeast: … }, { kind: "spl", mint:
  "msol", atLeast: … }, { kind: "sol", atMost: … }]` checked before/after.
  This is strictly better evidence than block deltas — consider backporting to
  EVM (the DS2 stETH check is currently manual).
- **Mirror liveness/authenticity probe**: `getHealth` + the loopback rule cover
  safety. A `surfnet_*` read probe would be the exact `anvil_nodeInfo` analog —
  find a read-only one on first run (only write-shaped cheatcodes are confirmed
  from source).

### 5. Trace truthfulness for SVM (parity with today's EVM fix)

`collectTxOutcomes` mines `wallet:tx_complete`; Solana completion flows through
different callback types (`wallet::solana_sign_complete`, and whatever
sign-and-send reports). Verify the actual event names/payloads from
`packages/client/src/session/wallet.ts`, extend the collector's accepted types,
and give the `svm-tx` interpreter family the same `tx_outcome` read the EVM
family now has. Small, mechanical, test-shaped like today's.

## The one genuine unknown: Jupiter on a fork

**Marinade will very likely replay on the mirror** — it is a pure on-chain
program (deposit → mSOL mint), exactly the shape Surfpool exists for.

**Jupiter is the risk.** Its quote API (api.jup.ag) builds transactions against
LIVE mainnet state — pool balances, address lookup tables, tick arrays. The
mirror lazily pulls referenced accounts from mainnet, so the tx *can* replay,
but state drift between quote-time and fork-state means slippage reverts are
plausible, and ALT resolution is untested.

**Phase 0 is therefore a spike, before any code**: mirror up, backend pointed
at it, then `aomi-cli --cluster mainnet-beta chat "swap 0.1 SOL to USDC"` and
`tx sign`. One afternoon answer to the only question that matters.

Fallbacks if Jupiter fights back, in order of preference:
1. Generous slippage in the scenario prompt (fork-only; costs nothing real).
2. Reshape scenario 6 around what forks cleanly: `svm_transfer` + Marinade
   ("Send 1 SOL to X, stake the rest") — less flashy, still proves the
   two-VM story, still executes on-chain.
3. Hybrid: Marinade leg on the fork (re-recordable), Jupiter leg once on real
   mainnet with tiny size as a proof video — the fork/proof split
   `DEMO-STUDIO.md` already endorses.

**byreal stays excluded** — off-chain orderbook, no fork can mirror it. That
call from the byreal doc was right; it was just wrong as a statement about all
of Solana.

## Phase 0 log (2026-08-01, in progress)

**Mirror: WORKS.** `test-env svm up --cluster mainnet-beta` boots Surfpool
against real mainnet (epoch 1010), applies the `[surfpool.mainnet-beta]`
config appended to the operator `providers.toml`, and the funding is verified
from chain state: 10 SOL airdropped + 25 USDC fabricated on the REAL Circle
mint (`EPjF…Dt1v`, ATA created) for the dedicated demo keypair
`HtVwaC8viyhowaUz6bmcfQNmwXXqEVq1e4Vr2ACs2LsA`
(`~/.aomi/test-env/svm/demo-mainnet-fork.json`, fork-only, never real).

**Fork-authenticity probe: SOLVED.** `getVersion` on Surfpool returns
`"surfnet-version": "1.0.0"` — a field no real RPC has. Read-only, standard
method; this is the `anvil_nodeInfo` analog the recorder needs.

**Plan revision — scenario 6 is SKILLS-ONLY.** Current main ships an
executable SVM protocol-skill roster (`crates/skills`, `svm_roster.rs`):
`jupiter` (injects `jupiter_prepare_swap`), `raydium`, `sanctum`, `debridge`,
plus semantic instruction staging (`svm_stage_ix`, IDL-manifest-guarded via
`svm-manifest-guard`) for `marinade`, `kamino`, `squads`, `meteora`,
`openbook`, `drift`. Like DS2/Lido on EVM: **no SDK apps needed**, richer
scenario surface than planned (Kamino lend, Meteora LP, Drift are candidates).

**Renames since the plan was written:** the backend scope env var is
`LOCAL_SCOPED_APPS` (not AOMI_APPS_ONLY); the #904 migration is applied, so a
current-main backend boots against the hosted DB (the pre-#904 demo worktree
binary is obsolete).

**Operational gotchas found:**
- First-ever surfpool exec stalls silently (macOS Gatekeeper scan): empty
  logs + readiness timeout. Retry once; second boot is instant.
- The generated `~/.aomi/test-env/providers.toml` goes stale when EVM proxies
  die — provider-manager init fails on `sim-ethereum` before Solana is even
  considered. For SVM-only work: `PROVIDERS_TOML=<input file>` +
  `SOLANA_MAINNET_RPC_URL=http://127.0.0.1:8899`.
- `cargo build -j2` gets SIGKILL'd (OOM) while Surfpool runs; use `-j1`, and
  never pipe cargo through `tail` (masks the exit code — a "successful" build
  notification shipped a stale binary and cost a debugging detour).
- Yesterday's CLI binary predates `svm-manifest-guard` registration while the
  skills bundle is current → "unknown hook" on every `svm_stage_ix` skill.
  Rebuild from current main required (in progress at -j1).

## Phase 0 VERDICT (2026-08-01): both legs execute on the mirror

Chain-state proof, demo wallet `HtVw…2LsA` on the Surfpool mainnet fork:

| Leg | Tx | Result |
| --- | --- | --- |
| Jupiter swap 0.5 SOL → USDC | `2gsoSk…kG1D` **finalized** | SOL 10 → 9.4999; USDC 25 → **60.96** (~35.96 received, within cents of the quote) |
| Marinade stake 2 SOL | `4ARUPe…Av8s` **confirmed** | SOL → 7.4999; **1.4313 mSOL** at the real exchange rate |

- **Jupiter replays cleanly** — real route (Deriverse), real ALT, and Surfpool
  substitutes `SURFNETxSAFEHASH…` as the recent blockhash: the mirror is built
  for exactly this. No slippage fallback needed.
- **Marinade works with one precondition**: the skill manifest blocks ATA
  creation (`svm-manifest-guard`), so first-time stakers fail simulation with
  `AccountNotInitialized`. Demo fix: fabricate an empty mSOL ATA via
  `surfnet_setTokenAccount` (works live; add `amount = 0`-style fixture or a
  studio funding call). Product fix: allowlist ATA create in the SVM manifests
  — task chip filed (needs skill-owner review, security-relevant).
- **Skills need the contracts DB** for IDL metadata: the CLI under
  FULL_TESTNETS panics on a hosted DB (the new guard, working as intended) —
  `AOMI_ALLOW_HOSTED_TEST_DB=1` for CLI spikes; the backend path used by the
  recorded demo resolves the DB normally and is unaffected.
- Phase 1 (portal `solana:mainnet` cluster) is DONE alongside the spike:
  union + parse/normalize/verify + provider type widened, 10/10
  e2e-wallet tests green in busy-wiles.

Remaining to a recorded take: phase 2 (recorder svm block + balance-assert
verify) and phase 3 (bind/client_auto ceremonies + take). Phase 0's fallbacks
are all moot.

## Execution order

| Phase | What | Exit criterion | Status |
| --- | --- | --- | --- |
| 0 | Spike: mirror up + CLI swap/stake attempt | Jupiter verdict; Marinade verdict | DONE — both YES |
| 1 | Portal `solana:mainnet` cluster + tests | e2e-wallet tests green | DONE (10/10) |
| 2 | Studio: svm scenario block, reset/fund, balance-assert verify | dry run passes on skills-only prompt | IMPLEMENTED (svm-env.ts, ds6 scenario); dry run pending |
| 3 | Keypair + bind/client_auto ceremonies + first take | `ds6-sol-swap-stake` master + balances verified | IMPLEMENTED (authorize-svm.mts); run pending |
| 4 | SVM trace-outcome parity | interpreter tests green | DONE (per-VM outcome maps; 38/38) |

Phases 1–2 are parallel-safe with the ongoing EVM studio work; phase 3 gates on
0's verdict. Rough shape: 0 is an afternoon, 1+4 are each smaller than today's
trace fix, 2 is the largest single piece (~half the original recorder).

## Standing safety rules (unchanged from EVM)

- The loopback rule on the SVM executor is the boundary — never relax it, never
  add a non-loopback cluster path "just for one take".
- Fresh, dedicated demo keys only; ceremonies revoked after; nothing written to
  the shared DB.
- Every take that claims execution must prove it from chain state (balance
  assertions), not from UI text.
