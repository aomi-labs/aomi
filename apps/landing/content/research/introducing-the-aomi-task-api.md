<!--
Aomi Blog post — introducing-the-aomi-task-api
slug: introducing-the-aomi-task-api
tag: launch
Figures live in public/research/introducing-the-aomi-task-api/figures/.
Source of truth for copy: Notion "Introducing the Aomi Task API" (launch brief).
-->

# Introducing the Aomi Task API: verified execution as a service, settled in USDC on Arc

Since launch, Arc has been building an agentic economy with real participants. Trading venues are opening their markets to agents. Protocols are exposing their contracts to them. Builders are shipping agents that pay invoices, rebalance treasuries and route liquidity. The agents are arriving, and USDC is already here.

For that economy to be robust rather than merely busy, two things have to be true.

**First, agents have to be reliable at onchain work.** Not reliable on average. Reliable on every task, with an outcome the user can verify before the money moves. An economy where every participant has to trust that the agent probably did the right thing is not an economy. It's a bet.

**Second, agents have to be on both sides of the market.** Every builder on Arc is creating something unique: a pricing model, a risk engine, a routing strategy, a vendor workflow. In a working economy those become services that other agents buy, priced by the result they deliver. Today's agents are mostly spenders. They need to be sellers too.

The Aomi Task API solves the first problem, and it delivers the second paradigm.

## How it works

![Builder, Aomi and Circle as three boxes. The agent sends a task with constraints to the Task API and gets a verified outcome and quote back. The app pays for the outcome through Circle Gateway, the artifact is released, the exact transaction goes to the Circle wallet for review and signing, Arc settles it, and the receipt returns to the app.](/research/introducing-the-aomi-task-api/figures/architecture.png)

An agent sends a task with its constraints: what it wants to do, the targets it may touch, the most it may spend. Aomi rehearses that task against live Arc state and returns the verified outcome: which balances move, which approvals get granted, and whether the limits hold.

If that's the outcome the agent wants, it pays in USDC and receives the exact transaction. Not a plan, not a suggestion. The bytes that produced the outcome it just saw.

The builder's Circle wallet decides whether to sign. Aomi never holds a key. Ever. No account, no API key, no custody. The wallet signs, or nothing happens.

![Sequence diagram in eleven steps across three authorities. Task authority: the agent signs a task with EIP-712, Aomi rehearses it on live Arc state and returns a verified outcome with a 402 quote. Payment authority: the agent pays in USDC through Circle Gateway and receives the exact transaction as an immutable artifact. Execution authority: the Circle wallet reviews and signs, Arc settles, and the app verifies the receipt before marking the job complete.](/research/introducing-the-aomi-task-api/figures/sequence.png)

None of this asks anyone to trust the agent. The agent sees the outcome, then pays. The wallet sees the transaction, then signs. Every step is checked by the party that would bear its cost.

## Pay for outcomes, not tokens

The price is $1 plus 3% of what moves. No subscription. No token meter.

![Two panels. Left, token metering: tokens consumed, calls made and compute minutes are billed whether or not there is an outcome. Right, outcome pricing: a verified outcome of 1,000 USDC to a vendor, approval of exactly 1,000 USDC, limits held, no reverts, priced at $1 plus 3% of 1,000 USDC, $31.00. Not the outcome you want? Don't buy it.](/research/introducing-the-aomi-task-api/figures/pricing.png)

Most agent infrastructure bills by effort: tokens consumed, calls made, minutes of compute. You pay whether the agent got anything done or not. The Task API charges for a result you have already seen. If the rehearsed outcome isn't the one you want, you don't buy it.

This is what makes agents reliable enough to run an economy on. Reliability isn't a promise about the model. It's a property of the transaction: verified before it's bought, bought before it's signed, signed only by the wallet that owns the funds.

## Agents buying from agents

The Task API is itself an agent-to-agent service. It's discovered and bought over x402, settled in USDC, priced per result. An agent on Arc can call it with no human in the loop and no relationship with Aomi beyond the signature on the request.

That's the pattern for every builder on Arc. Wrap what you know, your pricing model, your risk engine, your vendor workflow, into a task. Put a price on the outcome. Sell it to the agents that need it. The same rails that let an agent buy verified execution from Aomi let it sell its own expertise to the next agent.

Agents stop being only spenders and become sellers. That is the second half of the economy, and it's the half that compounds.

## What's live

The Aomi Task API is in preview on Arc Testnet, proven end to end with a paid run and real Arc receipts: a builder's existing agent, a verified outcome, a Circle wallet signing, and the transactions landing exactly as rehearsed.

Two ways in:

- **Already have intelligence?** Call the Task API through the Execution Kit. Keep your policy, your product and your users.
- **Need the agent too?** Agent-in-a-Box gives you one, with your own tools plugged in.

Either way the venue stays yours, the wallet stays yours, and the outcome is verified before it lands.

Mainnet follows, and we'll say when.

**Read the Execution Kit →** [arc-canteen.aomi.dev/execution-kit](https://arc-canteen.aomi.dev/execution-kit)
