# Mock Relayer — chain actors for forks

**Status:** Phase 1 BUILT (2026-08-01) on product-mono branch `chain-actor`,
uncommitted. Mechanism in `aomi-anvil::evm::actors`, `AcrossFiller` in the new
`aomi-actors` crate, `aomi test-env actors up/status/down` CLI, eval wiring
(`run.environment.actors` + multi-chain assertions). Live-smoked end to end:
1 ETH deposited into the mainnet-fork SpokePool → daemon filled via the real
Base-fork SpokePool → recipient +0.998 ETH native, journal `filled`.
**Consumers:** demo studio (this repo), `aomi-eval`, backend integration tests.

> Field discovery from the live smoke, §4.3-adjacent: the anvil mnemonic
> accounts (and therefore the demo wallet, account #2) carry **EIP-7702
> sweeper delegations on real mainnet and Base** — compromised keys with
> delegate code that steals any native ETH delivered by contract call, which
> is exactly what a bridge fill is. Outbound txs and ERC20 receipts are
> unaffected (why the staking/Aave demos held). Any recipient of a fill must
> be code-free: the demo recorder should `anvil_setCode(wallet, "0x")` on
> every fork at funding time.

---

## 1. The problem, concretely

Take `ds4-bridge-to-base`, take 1: the agent staged a clean Across deposit,
9.9 ETH left the wallet, `V3FundsDeposited` fired on our mainnet fork — and
nothing will ever happen next. Across fills are performed by third-party
relayer bots watching the *real* chain with their *own* capital. No bot watches
our fork, so the ETH sits in the SpokePool forever. The demo can only show
"bridge initiated", never "it arrived" — and "it arrived" is the money shot.

Eval has the same wall. `bin/eval/specs/across/bridge_base_usdc_to_arbitrum_send.json`
asserts `depositV3` was staged, the tx succeeded, USDC flowed into the
SpokePool… and stops. Not one bridge spec in `across/`, `cctp/`, or
`base_native/` asserts a destination-chain balance, because none can. Three
story classes (DS4, P3, P5) are permanently graded on half their journey.

The general rule this session surfaced: **anything that depends on an
off-chain actor cannot run on a fork** — the protocol contracts are all there,
fully functional; the *counterparty* is missing.

## 2. The insight: mock the counterparty, not the protocol

Anvil can impersonate any address. So we do not stub the bridge — we play the
missing role. A small process watches the source fork for the protocol's
deposit event and, wearing the relayer's costume, submits the **real fill
transaction to the real destination contract on a destination fork**. The
deployed SpokePool still performs every check a mainnet fill goes through; if
our fill doesn't match the deposit, *the protocol* reverts it. We supply the
actor, the chain supplies the validation.

This generalizes far past Across. The mockability test:

> **An off-chain actor is mockable iff its action is an on-chain transaction.**

| Actor | Mockable | How |
|---|---|---|
| Across relayer | ✅ | impersonate a filler, call `fillRelay` on dest SpokePool |
| OP-stack sequencer (canonical Base bridge) | ✅ (dest leg) | read `TransactionDeposited` on L1, mint the deposit on the L2 fork |
| CCTP attester | ✅ | swap attester set on the fork, sign locally, `receiveMessage` |
| 0x gasless relayer | ✅ | submit the user's signed order as a normal tx |
| Polymarket matching engine | ❌ | matching itself is off-chain |
| CEX order books | ❌ | entirely off-chain |

The 0x row matters: catalog scenario 3 (gasless swap) was written off as
unrecordable. Same mechanism unblocks it later, for free.

## 3. Naming

Umbrella term stays **mock relayer** — that's what everyone will call it.
Internally the abstraction is a **chain actor** (an off-chain participant we
impersonate), because "relayer" is wrong for the CCTP attester and the OP
sequencer. Proposed layout:

- `aomi-anvil` gains `src/evm/actors.rs` — the *mechanism* (trait + driver).
- New crate `aomi/crates/actors` (`aomi-actors`) — the *protocol adapters*.

Why the split (and not everything inside `aomi-anvil`, as first floated):
`aomi-anvil`'s job is chain processes — spawn, refork, ports, providers.
Adapters are protocol business logic: Across ABIs, CCTP attestation formats,
OP deposit semantics. Folding those in means every new bridge grows the
process-management crate and every fork-lifecycle change recompiles protocol
knowledge. The trait lives with the fork machinery it drives; the ABIs live
one crate up. (Counter-proposal if a whole crate feels heavy at three
adapters: a single `actors/` module tree inside `aomi-anvil` with the trait in
`actors/mod.rs` — acceptable, but the crate boundary is cheap and keeps the
dependency arrow pointing the right way: `aomi-actors → aomi-anvil`, never
back.)

## 4. Architecture

```
      source fork (chain 1)                    destination fork (chain 8453)
   ┌───────────────────────┐               ┌──────────────────────────────┐
   │  real SpokePool       │               │  real SpokePool              │
   │  V3FundsDeposited ────┼──── poll ───▶ │  fillRelay ◀── impersonated  │
   └───────────────────────┘      │        │   (protocol validates fill)  │
                                  │        └──────────────────────────────┘
                          ┌───────┴────────┐
                          │  actor driver   │  aomi-anvil::evm::actors
                          │  · watch loop   │  ProviderManager for both forks
                          │  · AcrossFiller │  aomi-actors adapter
                          │  · journal      │  ~/.aomi/test-env/actors.jsonl
                          └────────────────┘
```

### 4.1 Mechanism (`aomi-anvil::evm::actors`)

```rust
/// An off-chain participant we impersonate against local forks.
pub trait ChainActor: Send + Sync {
    fn name(&self) -> &'static str;
    /// (chain_id, contract, event signature) tuples to watch.
    fn watches(&self) -> Vec<Watch>;
    /// Called once per matching log. Decide, then act through ctx —
    /// or refuse, with a machine-readable reason.
    async fn on_event(&self, ctx: &ActorCtx, log: &Log) -> Result<ActorOutcome>;
}

pub enum ActorOutcome {
    Filled { chain_id: u64, tx_hash: B256 },
    Rejected { reason: RejectReason },   // serialized to the journal
    Ignored,                             // not this actor's event
}
```

`ActorCtx` wraps the existing `ProviderManager` and provides exactly three
powers: a provider per chain, `send_as(chain_id, from, tx)` (impersonate →
send → wait receipt → stop impersonating), and `deal(chain_id, token, to,
amount)` for capitalizing the actor's address. Nothing protocol-specific.

The **driver** owns a poll loop per watched chain (forks don't push; 500 ms
`eth_getLogs` over the new block range is plenty — refork resets are handled
by re-resolving the instance through `ProviderManager`, same lesson the demo
recorder learned about ports changing across resets). Every decision — fill,
reject, ignore — is appended to a JSONL **journal** with the deposit fields,
the verdict, and the reason. The journal is the actor's testimony; both the
demo runbook and eval assertions can read it.

Latency is a config, not an accident: `fill_delay_ms` (default 4000 for
demos — a beat of suspense on camera; 0 for evals — determinism). No other
randomness anywhere: same deposit in, same fill out.

### 4.2 Adapters (`aomi-actors`) — phased

**Phase 1 — `AcrossFiller`.** Watches `V3FundsDeposited` on every configured
SpokePool. Recomputes what a real relayer checks before committing capital:
destination chain is one we run, output token known on that chain, output
amount consistent with input (bounded slippage), `fillDeadline` not passed,
recipient parseable. If sane → deal itself the output tokens on the
destination fork, impersonate the relayer address, call the real destination
SpokePool's `fillRelay`. The SpokePool's own validation is the final word.

**Phase 2 — `OpDepositFinalizer`** (the "mock sequencer"). Watches
`TransactionDeposited` on the L1 `OptimismPortal`/`L1StandardBridge`, replays
the deposit as the system depositor account on the L2 fork. Upgrades the
canonical `ds4` story from "half true" to complete.

**Phase 3 — `CctpAttester`.** Watches `MessageSent` on `MessageTransmitter`,
signs the message with a local key it has (as fork admin) enrolled via
`enableAttester`, submits `receiveMessage` on the destination fork. Unblocks
the P3 eval story.

**Phase 4 — `ZeroXGaslessRelayer`.** Submits the user's signed gasless order.
Different shape (no second chain), same trait.

One adapter ships per phase. **No plugin framework until adapter two exists**
— design the abstraction from two real implementations, not zero.

### 4.3 Strictness contract (the trap this design refuses)

A lenient mock is worse than no mock: if the filler accepts anything, every
malformed deposit "succeeds" and we've stopped testing the agent and started
testing our own generosity. Therefore:

1. An adapter must **reject** any deposit a rational real counterparty would
   not act on, and record why.
2. The fill must go through the **real deployed destination contract** — never
   a direct `setBalance` on the recipient (the OP finalizer is the one
   principled exception, because minting *is* what the real system does).
3. The claim we certify is not "funds arrived" — our own actor caused that.
   It is: **"the agent produced a deposit a correct relayer would have
   filled"** — plus the real on-chain effects of that fill.

## 5. Surfaces

### 5.1 CLI (`aomi test-env`)

```bash
aomi test-env evm up --chains 1,8453          # forks, as today
aomi test-env actors up across                 # start the actor daemon
aomi test-env actors status                    # watching what, filled what
aomi test-env actors down
```

Detached daemon, pidfile + journal under `~/.aomi/test-env/`, same lifecycle
idioms as the fork proxies. `actors up` fails fast if a watched chain has no
running fork.

### 5.2 Demo studio (this repo)

`Scenario` grows one field:

```ts
/** Chain actors to run during the take (`across`, `base-native`, `cctp`).
 *  The recorder starts them after reset+funding and stops them after. */
actors?: string[];
```

`ds4-bridge-to-base` becomes `chains: [1, 8453]`, `actors: ["across"]`, and
its `expectsExecution` check extends naturally: block advance on **both**
forks, plus a destination balance read for the verify log. On camera:
the agent bridges, four seconds pass, the balance appears on Base *while
the UI still says Ethereum → Base Mainnet*. That is a complete cross-chain
demo with zero real capital — currently impossible.

The route-drift problem (turn 1 narrated canonical, turn 2 executed Across)
also dissolves: we stop needing to pin the canonical route for forkability
reasons and can let the agent pick Across, which is what it wants to do
on real mainnet anyway. The demo gets *more* honest.

### 5.3 Eval (`aomi-eval`)

Preflight already builds chains via `aomi_anvil::provider_manager()`, so the
integration is one field in `run.environment`:

```json
"environment": {
  "chain_id": 8453,
  "extra_chains": [42161],
  "actors": ["across"]
}
```

Preflight starts the actors in-process (no daemon needed — same crate,
`tokio::spawn` the driver, abort on teardown). Then the *existing* assertion
types finish the story with zero new assertion code:

```json
{ "type": "event_log",     "chain_id": 42161, "address": "<arb SpokePool>",
  "event_signature": "FilledRelay(...)", "min_count": 1 },
{ "type": "balance_delta", "chain_id": 42161, "account": "alice",
  "asset": "USDC", "delta": "+5", "tolerance": { "type": "percent", "value": 5 } }
```

`bridge_base_usdc_to_arbitrum_send` upgrades from "deposit looked right" to
"Alice's USDC exists on Arbitrum" — a genuine end-to-end grade. The
`callback_after` turn hook stays available for scripted variants ("tell the
user when it lands"), but the background driver is the primary mode: fills
should occur while the agent is still narrating, like reality.

Optional phase-2 assertion, only if the journal proves useful in practice:
`{"type": "actor_journal", "actor": "across", "outcome": "filled", "min_count": 1}`
— which would also let evals assert the *negative* ("this malformed deposit
was **rejected**"), turning the strictness contract itself into a graded
surface.

### 5.4 Actor identity & capital

The actor signs as a dedicated **`Relayer`** entry in `providers.toml::faucets`
(the same named-faucet mechanism `builtin:alice` uses) — *not* a scenario
faucet account, so its nonces never race demo funding, and eval aliases can
reference it. Capital is dealt on demand by the driver (`deal` +
`anvil_setBalance` for gas): the mock relayer is infinitely solvent by
construction, and the journal records every deal so balance assertions on the
relayer itself stay possible.

## 6. Non-goals

- **No relayer economics.** No fee auction, no exclusivity windows, no
  profitability model. One honest, strict, instant-ish filler.
- **No mainnet capability.** The crate refuses to run against a non-anvil
  endpoint (same `anvil_nodeInfo` probe the e2e wallet uses, same fail-closed
  posture). This is test/demo infrastructure and must be inert elsewhere.
- **No off-chain-native actors.** Polymarket matching and CEX books stay
  unmockable; the demo answer there remains a real-mainnet proof video.

## 7. Build order

| Phase | Deliverable | Unblocks |
|---|---|---|
| 1 | trait + driver + journal in `aomi-anvil`; `AcrossFiller`; `test-env actors` CLI | `ds4-bridge-to-base` recorded end-to-end; `across/*` eval specs gain dest assertions |
| 2 | `OpDepositFinalizer` | canonical-bridge story DS4 complete; `base_native` eval |
| 3 | `CctpAttester` | P3 eval story; USDC-native bridge demo |
| 4 | `ZeroXGaslessRelayer` | catalog scenario 3 (gasless swap) recordable |

Phase 1 is deliberately the whole vertical slice — mechanism, one adapter,
both consumers — because the second adapter, not more planning, is what
validates the trait.

## 8. Open questions

1. **Crate vs module** (§3): separate `aomi-actors` crate, or `actors/`
   module inside `aomi-anvil`? Spec recommends the crate; either preserves
   the mechanism/adapter boundary.
2. **Fill latency on camera**: 4 s default is a guess. Worth asking the
   borrowed trader what a credible Across fill time looks like to a pro
   (real answer: seconds to ~a minute depending on chain).
3. **Arbitrum fork**: the existing Across eval bridges Base→Arbitrum, so
   phase 1 eval needs a 42161 fork target in `providers.toml` — confirm one
   exists or add it.
