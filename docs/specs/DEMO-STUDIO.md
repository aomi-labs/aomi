# Demo Studio — systematic demo capture

Status: design agreed, not yet implemented.
Owner: Cecilia. Created 2026-07-30. Revised 2026-07-30 after reading
`product-mono/docs/topics/testing-automation/facts/`.

## Why

We can't demonstrate the product. The failure mode is not video editing — it is
that we have no deterministic, funded, scriptable environment to demo against.
A demo recorded against live mainnet with an unfunded wallet produces takes like
"I can see your ETH balance is 0 ETH", which is a correct answer to a useless
question.

Recording is the easy last mile. This spec is mostly about the environment.

## Locked decisions

| Decision | Choice |
| --- | --- |
| Audience | BD calls **and** social **and** docs |
| Capture strategy | **Record one master per scenario, cut three ways.** Never re-shoot per format. |
| Environment | Pinned EVM fork via the **existing** `aomi test-env`, plus real-mainnet for Solana and 1–2 proof videos |
| Wallet | Full-testnet wallet routing — no extension, no popups, no seed phrase on camera |
| Content validation | External trader reviews the scenario catalog before we build capture |

"Record once, cut three ways" is load-bearing. A 2-minute BD take contains the
20-second social loop and the 8-second docs loop inside it. The studio emits a
master MP4 **plus timestamped markers**; short cuts are derived from markers,
never re-recorded.

## Three layers

### Layer 1 — Scenarios (content)

See `docs/specs/DEMO-SCENARIOS.md`. Blocking on external trader review. Build nothing
downstream until the catalog is signed off — a beautiful studio pointed at
unconvincing scenarios is wasted work.

**Shortcut worth taking:** `product-mono` already maintains a validated story
catalog (`DS1`–`DS6`, `P1`–`P8`, `APP1`–`APP4`, `AA1`–`AA8`, `PAY1`–`PAY5`) in
`docs/topics/testing-automation/facts/aomi-transact-automation.md`, with exact
prompt text and known-good routes, run on a daily/weekly schedule. **Any story
that currently passes the smoke lane is a scenario that will record cleanly.**
Derive demo scenarios from passing stories rather than inventing prompts.

### Layer 2 — Fixture (determinism) — ALREADY EXISTS, DO NOT BUILD

This was the bulk of the estimated work and it is already done in `product-mono`.

`aomi test-env` is a local test-environment lifecycle command group gated on
`FULL_TESTNETS=true`:

```
aomi test-env up --chains ...   # spawn detached anvil-fork proxies per chain
aomi test-env status            # list running proxies and ports
aomi test-env reset --chain N   # refork one chain, leave the rest alone
aomi test-env down              # stop and clear state
```

State lives in `~/.aomi/test-env` (`providers.toml`, `pids.json`, `funded.json`,
`logs/`). Proxies are detached, so they survive the CLI exiting. Pre-funding
gives the faucet native ETH via `anvil_setBalance` and ERC-20 balance by
impersonating a chain-specific USDC whale.

**The property that makes this perfect for demos:** the frontend full-testnet
routing **preserves real chain IDs** (`1`, `8453`) and only swaps the RPC URL:

- `NEXT_PUBLIC_USE_FULL_TESTNET=true`
- `NEXT_PUBLIC_FULL_TESTNET_RPC_MAP`
- `useFullTestnet(...)` / `FullTestnetWalletRouter` / `isFullTestnet()`

So the UI renders **"Ethereum · Mainnet"** — exactly as in the screenshot that
started this work — while every transaction executes against a local fork. It is
explicitly *not* modeled as Localhost `31337`. Demos look real because the chain
identity on screen *is* real; only the RPC is local.

Layer 2 work is therefore reduced to: pick fork block heights, extend funding
beyond ETH/USDC for scenarios that need other tokens, and wire the capture
runner to `test-env up` / `reset`.

### Layer 3 — Capture (automation)

Playwright drives the portal, types prompts at human cadence, waits on real UI
states (never `sleep`), records video. One MP4 per scenario plus a marker JSON.
Between takes, `aomi test-env reset --chain N` restores identical state.

Run in CI on every release. **Demos then cannot go stale.**

## Environment matrix

A pinned EVM fork does not cover the whole surface.

| Venue class | Examples | Fork? | Plan |
| --- | --- | --- | --- |
| EVM spot / bridge / lend / stake | Uniswap, Lido, Rocket Pool, Ether.fi, Aave, CoW, 1inch, 0x, LiFi, Across, CCTP, Stargate | Yes | `aomi test-env` pinned fork |
| Solana | Jupiter, Marinade, byreal, svm_transfer | **No** | Mainnet, tiny amounts |
| Prediction markets | Polymarket, Limitless, Kalshi, Manifold | Partly — Polygon settlement, live off-chain CLOB | Real account, small size |
| CEX | Binance, Bybit, OKX | No | Venue sandbox API keys |
| Read-only data | DefiLlama, Dune, GeckoTerminal, Hyperliquid, dYdX, GMX, Morpho, Yearn, l2beat, Kaito, Neynar | N/A | Live APIs, response-cached |

**Plan (2026-07-31 late): `docs/specs/SOLANA-DEMO-PLAN.md`** — full replication
plan for scenario 6 on a Surfpool mainnet fork. Key upgrades over what's below:
mainnet-beta forking and declarative USDC fixtures (`surfnet_setTokenAccount`)
already exist in `test-env svm`; the only real code gap is the portal's
`solana:mainnet` E2E cluster; the only real unknown is Jupiter-quote replay on
fork state (phase-0 spike). Slot advance is NOT execution proof on Surfpool —
balance assertions replace the block-delta heuristic.

**Correction (2026-07-31): Solana is not as settled as stated above.** I earlier
called it closed on the strength of `byreal-solana-test-plan.md`. Reading the CLI
source shows a whole `aomi test-env svm` command group — a Surfpool-backed local
SVM mirror with `up` / `down` / `status` / `reset`, plus `wallet`, `airdrop` and
`usdc` helpers.

The byreal doc is still right about *byreal*: its orderbook is an off-chain API
that no fork can mirror. But that says nothing about on-chain Solana programs.
Jupiter and Marinade are on-chain, so a mainnet-forked SVM mirror may serve them
fine. **Unverified** — try the SVM mirror before accepting real-money Solana
takes.

## Verified capability boundary

Two distinct layers, and I initially conflated them:

**SDK apps / plugins** — verified by reading `~/Code/aomi-sdk/apps/*/src/*.rs`:

- *Execute:* Across, Binance, Bybit, OKX, CoW, Jupiter, 1inch, 0x (including
  **gasless**), LiFi, Khalani, Marinade, Polymarket, Polymarket Rewards,
  Limitless, Kalshi, Manifold, Krexa (borrow USDC), Delta, svm_transfer.
- *Read-only:* Hyperliquid, dYdX, GMX, Morpho, Yearn, DefiLlama, Dune,
  GeckoTerminal, l2beat, Kaito, Neynar, X.

**Protocol skills** — a separate layer, referenced throughout the story catalog:
Uniswap, Lido, Rocket Pool, Ether.fi, Aave, CCTP, Stargate, Base native bridge,
Pendle. These execute.

Consequence: **liquid staking is demoable.** The exact conversation in the
screenshot that motivated this work — "stake half of my ETH", agent proposes
Lido / Rocket Pool / Ether.fi — maps to stories `DS2`, `DS3`, `P1`, which run in
the smoke lane. It failed only because the wallet held nothing. On a funded fork
it works.

**Unverified:** byreal's perps path. `byreal-solana-test-plan.md` (status:
`reference`, not authoritative) describes perps build-order / submit / cancel
flows, which would contradict the read-only finding for the standalone
`hyperliquid` plugin. byreal's source is not in this checkout — only a
`Cargo.lock` — so this needs checking against byreal's source or a live tool
listing before any perps scenario is scripted. Until then, assume no perp
execution.

## The wallet layer is a test double (2026-08-01)

Recordings use the portal's E2E executor, not the production wallet stack:
`viem` / `@solana/web3.js` + `tweetnacl` + an HMAC session cookie, with **zero
`@getpara/*` imports**. The `providers/para/` plugin is not on the recording
path.

Consequence for claims: a take proves the agent, backend, skills, permit,
simulation, broadcast and chain state — it proves **nothing** about the wallet
integration. And because the stub hardcodes `walletProvider: "para"`, the
account chip in current takes shows a **Para badge it has not earned**; relabel
the stub or wire real Para before any partner-facing cut.

Full detail, including why no signature popup appears (`client_auto` mode + the
permit ceremony) and caption guidance: `demo/README.md` → "What a take proves —
and what it does not".

## On-camera gotchas

These will each ruin a video if discovered late.

- **`aomi tx sign` prints the fee-transfer hash, not the protocol tx hash.** The
  fee goes to `0x9C7a99480c59955a635123EDa064456393e519f5`. If a demo shows a
  hash and a partner pastes it into a block explorer, they will see a fee
  transfer, not the swap. Capture the protocol hash explicitly.
- **Route leakage.** A prompt naming Uniswap can leak to LI.FI or SushiSwap —
  there is a dedicated sentinel story (`DS6`) because this happens. In a demo,
  a leak means the video shows the wrong protocol. Either pin the protocol in
  the prompt or accept whatever route and don't claim otherwise in the voiceover.
- **A dead local `providers.toml` makes a healthy run look flaky**, even against
  a hosted backend, because the tool path may consult local provider config.
- **`test-env up` requires `ALCHEMY_API_KEY`** for fork URLs.
- **There is no `test-env seed` subcommand.** Seed arbitrary addresses by calling
  the proxy directly:

```bash
curl -s http://127.0.0.1:$PORT -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"anvil_setBalance","params":["0xTARGET","0x56BC75E2D63100000"]}'
```

- **Pre-funding covers ETH and USDC only.** Other ERC-20s need an added
  chain-specific whale-impersonation route. Scenarios needing WETH, DAI or LP
  tokens carry extra fixture work — factor this into scenario selection.

## File layout (proposed)

```
demo/
  scenarios/*.scenario.ts    # Layer 1, one per scenario
  capture/                   # Layer 3, playwright runner + test-env orchestration
  out/                       # master MP4 + markers.json per scenario
```

No `fixtures/` directory — Layer 2 is `aomi test-env` in `product-mono`.

## Open items

- Fork block heights per chain (pick blocks with healthy liquidity)
- Verify byreal perps write capability before scripting any perps scenario
- Extra whale-impersonation routes for non-USDC tokens
- CEX sandbox credentials — do Binance/Bybit testnets cover the tools we call?
- Which scenarios get real-mainnet proof videos with a visible protocol tx hash
- Where finished videos land in the GTM system at scrum.aomi.dev

## Sources

- `product-mono/docs/topics/testing-automation/facts/full-testnet.md`
- `product-mono/docs/topics/testing-automation/facts/aomi-transact-automation.md`
- `product-mono/docs/topics/testing-automation/facts/byreal-solana-test-plan.md`
- `~/Code/aomi-sdk/apps/*/src/*.rs` (capability sweep, 2026-07-30)
