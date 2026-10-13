# Demo scenario catalog — for external review

**If you are the trader reviewing this: thank you. You need ~30 minutes.**

We are building a library of short product demo videos. Every scenario below is
something our agent can actually do today — we verified each against the code
and against an existing automated test suite, and cut several that sounded good
but weren't real.

We are not asking you to design trading strategies. We are asking you to catch
the places where this reads as naive to someone who trades for a living.

For each scenario, three questions:

1. **Would anyone actually say this?** Is the prompt how a real user phrases it,
   or how an engineer imagines a user phrases it?
2. **Is the outcome impressive or obvious?** Would you be interested, or is this
   table stakes?
3. **Are the numbers realistic?** Sizes, pairs, venues, thresholds.

Mark each **KEEP / FIX / CUT** and leave a line of why. A CUT is as useful as a
KEEP.

*(Engineering note: the `story` tag on each scenario maps to an existing test
story that already runs on a schedule. Those paths are proven and will record
cleanly. Scenarios without a tag need a fresh path built.)*

---

## 1. Agent-run market making on Polymarket

**Prompt:** "Quote both sides of the Fed-cut-in-September market, about $500 a
side, and keep me inside the reward band."

**What happens:** The agent pulls the live orderbook, builds a quote plan with
resting bids on both YES and NO, prices them to sit inside the liquidity-reward
band, submits the orders, and can later withdraw the quoted liquidity on command.

**Why we lead with this:** Every competitor's "agentic wallet" demo is a token
swap. This is an agent running a market-making book. We have not seen anyone
else show it.

**Money shot:** resting orders appearing on both sides of the book, then the
reward-band position confirmed.

**Reviewer verdict:** ______ — because:

---

## 2. "Stake half my ETH in the highest-yield pool"

*story: `DS2`, `DS3`, `P1`*

**Prompt:** "Stake half of my ETH in the highest yield pool."

**What happens:** The agent checks the balance, compares liquid staking options,
picks one, stages and simulates the transaction, and executes.

**Why it matters — and this one is personal:** this is the exact prompt that
produced our most embarrassing demo attempt. The agent did ten steps of correct
work and then said "your balance is 0 ETH", because the wallet was empty. The
reasoning was right; the environment was wrong. Recording it working is both a
good demo and the proof that the studio fixed the actual problem.

**Money shot:** the ten-step reasoning trace, ending in an executed stake rather
than an apology.

**Reviewer verdict:** ______ — because:
*Specifically: does "highest yield pool" invite a comparison that makes us look
good, or one that makes us look like we're ignoring risk and lockup differences?*

---

## 3. Swapping with an empty gas tank

**Prompt:** "Swap 2,000 USDC for ETH. I don't have any ETH for gas."

**What happens:** The agent detects there is no native balance for gas, routes
through a gasless swap (signed order, relayer pays gas, fee taken from the input
token), and completes the swap.

**Why it matters:** the single most relatable onboarding failure in crypto,
solved in one sentence.

**Money shot:** zero ETH balance visible on screen, swap completes anyway.

**Reviewer verdict:** ______ — because:

---

## 4. Best execution across CEX and DEX

*story: partial — `DS5`, `P6`*

**Prompt:** "I want to sell 10 ETH. Where do I get the best fill right now —
including the exchanges?"

**What happens:** The agent pulls CEX orderbook depth, DEX aggregator quotes and
an intent-based DEX quote in parallel, compares net of fees and slippage, shows
the comparison, and executes on whichever wins.

**Why it matters:** nobody else's agent treats CEX and DEX as one execution
surface. The side-by-side comparison is the proof.

**Money shot:** the venue comparison table, then execution on the winner.

**Reviewer verdict:** ______ — because:
*Specifically: is 10 ETH the right size to make the venue difference visible?*

---

## 5. Bridge and swap in one sentence

*story: `DS4`, `P3`, `P5`*

**Prompt:** "Move half my USDC to Base and put it into ETH."

**What happens:** One prompt becomes approval, bridge, wait for finality, then
swap on the destination chain — the agent tracks deposit status across the gap
and resumes on its own.

**Why it matters:** four transactions across two chains that most people do by
hand across three tabs. The waiting-and-resuming is the hard engineering.

**Money shot:** the multi-step trace completing across two chains unattended.

**Reviewer verdict:** ______ — because:

---

## 6. One agent, two virtual machines

**Prompt:** "Swap 5 SOL for USDC, then stake the rest."

**What happens:** Solana-side swap, then liquid staking — same conversation,
same agent, same UI as the Ethereum scenarios.

**Why it matters:** most agentic wallets are EVM-only. EVM and Solana in one
product without a mode switch is a real architectural differentiator.

**Production note (corrected 2026-08-01):** an earlier version of this entry
said this scenario **cannot run on a fork** and would have to be shot on
mainnet with real money as a one-take proof video. **That was wrong**, and it
was wrong in the expensive direction — it would have had us spending real SOL
on camera for no reason.

It runs on a Surfpool mainnet mirror, and it is now recorded: a Jupiter swap
and a Marinade stake, both confirmed on-chain, re-recordable for free
(`demo/out/ds6-sol-swap-stake`). Jupiter replays cleanly against the mirror —
real route, real address-lookup table — which was the one genuine unknown.

Two things this take cost us that are worth knowing before scripting more
Solana scenarios: the agent does not build the same instruction bundle every
run (three consecutive takes died in a repair loop), and a turn that stops
streaming has not necessarily finished its transaction. Both are handled in
the studio now; see `demo/README.md`.

**Money shot:** the chain switcher, same agent handling both.

**Reviewer verdict:** ______ — because:

---

## What we cut, and why

**A delta-neutral basis trade.** It demoed beautifully on paper and we cannot do
it. Our perps integrations — Hyperliquid, dYdX, GMX — are **read-only**. We can
read funding rates, positions and orderbooks; we cannot open a perp position.

There is one unresolved thread: an internal test plan describes perps order
placement through a different integration, which would contradict this. We
haven't been able to verify it, and we would rather cut a scenario than script
one we can't deliver.

If you find yourself wanting to suggest a perps scenario, **say so anyway** —
that is the clearest possible signal about what we should build next, and it is
worth more to us than a polished video.

## The one question that matters most

**If you could only show a fintech partner one of these, which one, and why?**

______
