<!--
Aomi Blog post — introducing-the-agentic-fuzzer
slug: introducing-the-agentic-fuzzer
tag: launch
Figures live in public/research/introducing-the-agentic-fuzzer/figures/.
Rich blocks (::fuzzer-*::) render from app/(marketing)/research/[slug]/agentic-fuzzer-research.tsx.
Source material: the agentic fuzzer application package (October 2026).
-->

# Introducing the Aomi Agentic Fuzzer: the agent plans the attack, deterministic code proves the bug

_October 26, 2026. Preview for Arc Studio apps._

The Agentic Fuzzer is in **public preview** at [fuzzer.aomi.dev](https://fuzzer.aomi.dev), running on Aomi's staging backend. Past the connect screen you need an Arc Studio token and a wallet sign-in to an Aomi account. Nothing it does is signed, deployed or broadcast, and no contract is ever called safe.

Smart-contract bugs live in sequences, not lines. The exploits that drain protocols appear when several actors call functions in a particular order, and no linter, code reviewer or model reading the source line by line will find them. Today we are releasing a security agent for Arc Studio apps that searches that space directly: the AI agent plans the attack, and a deterministic engine on a held Arc fork decides what counts as a finding.

We call the method **agentic fuzzing**.

::fuzzer-define::

The rest of this post is the technical explainer: why sequences are the problem, how the search works, what the engine owns, what we have proven so far, and what we have not.

## Why sequences, not lines

A fuzzer treats a contract as a state machine and asks whether any reachable state breaks a rule that should always hold. The hard part has never been the execution. It is the setup: someone has to model the protocol, write the rules, and script every actor. For a stateful invariant fuzzer that is days of expert time per contract, and the handlers go stale the moment the contract changes.

The space is also larger than it looks. Take one lending pool generated in Arc Studio, counted before choosing a single argument value:

::fuzzer-count::

Linters and AI code review read lines and never execute anything. Invariant fuzzers execute sequences but need a human to write what the protocol should do. The gap is a tool that understands the protocol from source, searches ordered multi-actor sequences against real chain state, and needs no handler code to start.

## What agentic fuzzing means

**Agentic fuzzing** is stateful fuzzing where an AI agent writes the threat model, the rules and the actions, and deterministic code on a held chain fork decides what counts as a finding. The model proposes; it is never the judge.

That one design rule drives everything below. Frontier models are good at reading a contract and guessing where it is weak. They are not trustworthy as the final word on whether an exploit is real, because a model can assert an outcome it never observed. So the fuzzer splits the job: the model supplies the hypothesis, and code supplies the truth.

## How it works: breadth-first search on a held Arc fork

The engine models an investigation as a tree of ordered call sequences. The root is a baseline snapshot of the fork with the contract installed and the actors funded. Every edge adds one call by one actor. The search is breadth first: all one-call sequences, then two-call extensions of the paths that reached a new state, and so on, under a depth cap and an execution budget.

![Breadth-first search over call sequences on UnsafeVault. Depth 0 is the funded baseline snapshot. At depth 1, bob's withdraw fails on an empty vault and is pruned, bob's deposit reaches the same state shape as alice's and is pruned, and alice's deposit reaches a new state and is kept. At depth 2, bob's withdraw after alice's deposit succeeds and pays bob 5 USDC, breaking the rule; the sequence is minimized and replayed twice before it becomes a finding.](/research/introducing-the-agentic-fuzzer/figures/bfs.svg)

Figure 1. Breadth-first search over call sequences, on the mock vault used throughout this post. Kept nodes reached a new state; pruned nodes repeated a known state shape or dead-ended. The red path broke the rule and was confirmed by replay.

The example is a deliberately small vault, `UnsafeVault`, that credits deposits to the caller but pays withdrawals without checking that credit. The rule the agent wrote: a caller with no deposit must not be able to withdraw. At depth 1, every withdraw reverts because the vault is empty, and that is not noise. Reverts tell the engine which preconditions are unmet and which paths are dead. At depth 2, alice's deposit followed by bob's withdraw succeeds, bob's balance goes up, and the rule is broken.

Three roles share that tree.

::fuzzer-roles::

### Seven jobs the model never does

::fuzzer-jobs::

## Why the trace matters: the loop as tool calls

A campaign is `arc_fuzz_start`, then `sim_replay_traces` and `arc_fuzz_round` alternating, then `arc_fuzz_report`. The trace is the audit log. Anyone reading it can see which sequences actually ran, which reverted, and which were only ideas.

::fuzzer-trace::

## A campaign, start to finish

Here is the loop from the builder's side, on the mock vault. A builder pastes an Arc Studio token. Targets come from their own workspace; no handler code is written.

![The Agentic Fuzzer workbench on the UnsafeVault mock. Left: fuzz targets and campaign history. Centre: the contract source and the campaign counters. Right: the agent panel with its investigation plan: hypothesis, roles, property and actions.](/research/introducing-the-agentic-fuzzer/figures/plan.png)

Figure 2. The agent's investigation plan, shown in the open before the first replay batch is issued. Hypothesis: an unprivileged actor can withdraw funds without a corresponding deposit. Property: unauthorized withdrawal must revert.

The agent reads the source, maps the callable surface and writes an investigation plan: a hypothesis, the actors, and an executable property. Everything after this is an attempt to falsify that property.

![The observed execution tree mid-campaign. Baseline snapshot, then deposit by the depositor, then withdraw by the attacker, with a queued extension and a reverted sibling. The counters read 3 of 32 executions, 8 queued in the frontier, 2 states expanded.](/research/introducing-the-agentic-fuzzer/figures/tree.png)

Figure 3. The observed execution tree while the engine explores. Executed, queued and reverted nodes are marked. The budget strip tracks executions against the cap, and the caption under it says what it is: exploration is bounded, not a measure of contract safety.

The engine runs ordered multi-actor sequences on the fork and the tree fills in. Reverts stay in the tree because they are evidence too.

![The finished campaign. The attacker's withdraw after the depositor's deposit is marked as a confirmed finding, the replay history shows the sequence executed from baseline, and the watched balance changes are expanded. The agent panel reads: confirmed property violation, the two-call sequence reproduces from the baseline twice.](/research/introducing-the-agentic-fuzzer/figures/confirmed.png)

Figure 4. A path becomes a confirmed finding only after it replays twice from baseline. The engine records each call's status, the replay history, watched balance changes before and after per address, and probe results.

![The verified finding card: the property, the two-call sequence depositor deposit then attacker withdraw, observed balance changes, and the round, execution and corpus counters, with Arc fork and no signing in the footer. Below it, the agent's conclusion and a button to send the finding to Arc Studio for a fix.](/research/introducing-the-agentic-fuzzer/figures/handoff.png)

Figure 5. The verified-finding card and the hand-off. The agent explains the finding and drafts a fix; sending that fix back to Arc Studio and re-running the campaign to confirm it holds is on the roadmap.

The screens above are from the preview build, as a fixture walkthrough of the interface on the mock vault. The verified run's own figures are in the next section.

## Evidence: the UnsafeVault run

The product's whole claim is that findings are evidence and nothing else, so here is the one verified finding we have, with its limits. The agent wrote the rule and the actors. The engine found the shortest sequence that breaks it. The fork replayed it twice before anything was reported.

::fuzzer-evidence::

**How to read a report.** It is a bounded search. When nothing breaks, the report says which rules held within budget and which surfaces were not reached. Ideas the agent did not run are labelled as hypotheses. It never calls a contract safe, and nothing here presents the test-contract run as a customer finding or a mainnet finding.

## Where agentic fuzzing sits

| Capability                              | Linters     | AI code review | Invariant fuzzers               | Agentic Fuzzer                     |
| --------------------------------------- | ----------- | -------------- | ------------------------------- | ---------------------------------- |
| Understands what the protocol should do | No          | Yes            | Needs a human to write it       | Yes, from source                   |
| Executes against real chain state       | No          | No             | Local or forked, set up by hand | Held Arc fork per campaign         |
| Multi-actor, ordered sequences          | No          | No             | Yes                             | Yes, roles chosen by the agent     |
| Findings proven by replay               | No          | No             | Yes                             | Minimized, replayed twice          |
| Setup per contract                      | None        | None           | Days of handlers and properties | None: connect Arc Studio           |
| Closes the loop with the builder        | Report only | Suggestions    | Report only                     | Drafts the fix; write-back planned |

## Built on the Aomi harness

Aomi Labs builds the execution harness for onchain finance: a hosted runtime where agents call typed tools, every transaction first runs on a copy of live chain state, and the user's own wallet signs. A chain fork is CI for transactions. The Agentic Fuzzer turns that same loop on the contract itself, as an Aomi app on the same runtime. It needed no new fork service and no new model router, only a new question.

![Three owners on one runtime. Arc Studio, the builder, supplies the source, the compiled artifact and the account's deployments through the builder's token, and receives the report and drafted fix. The Aomi app holds the agent, which writes the threat model, rules, actors and action templates on a model from Aomi's catalog, and the campaign engine, deterministic code that validates the plan, owns the frontier, dedup and order, minimizes and replays twice. The held Arc fork, chain 5042 at a pinned block, installs or runs in place, funds actors and runs calls, and never signs or broadcasts.](/research/introducing-the-agentic-fuzzer/figures/architecture.svg)

Figure 6. Three owners on one runtime. The builder's Arc Studio account is the only source of targets. The agent and the engine run inside one Aomi app. The fork is the same held-chain-state service every Aomi app uses to test a transaction before a wallet sees it.

::fuzzer-harness::

The pairing agentic fuzzing depends on, a model that proposes next to deterministic code on a held fork, is the pairing Aomi runs in production every day.

## Scope, safeguards and dual use

An agentic fuzzer produces concrete exploit sequences. That is the point, and it is why the product rests on three facts: where targets come from, where sequences run, and who may call something a bug.

::fuzzer-facts::

The Arc Studio token is verified with Arc Studio, then kept only in an encrypted, httpOnly cookie on the preview site for seven days, and is revocable from Arc Studio at any time. Campaign state and findings live on Aomi's staging backend under the account that ran the campaign. Models are chosen per campaign from Aomi's catalog; the production default is a Claude model, and provider data terms apply per model.

**On dual use.** An agentic fuzzer is an automated attacker. We keep it useful to defenders and useless to anyone else the same way the rest of Aomi does: it acts only on a copy of chain state, has no path to a signature, takes targets only from the account that owns them, and leaves every drafted fix in a human's hands. The planned audit log and human-review step are how we expect to meet security programs' partner requirements.

## What's next

The loop works. The next six steps take it from a prototype that proves a bug in a mock vault to a product a builder runs on their own deployment, gets a fix back from, and can show to an auditor.

::fuzzer-roadmap::

If you build on Arc Studio and want to run the fuzzer on your own app, we want to hear from you.

## Try it out

- **Preview:** [fuzzer.aomi.dev](https://fuzzer.aomi.dev). The page is public; past the connect screen you need your own Arc Studio token and a wallet sign-in to an Aomi account. The backend runs on Aomi's staging environment.
- **Walkthrough video:** [a recorded campaign on the mock vault](https://drive.google.com/file/d/1dt3q6XBbFOVrmipbT_OtFIcN1Jn6ZUg8/view), from connect to confirmed finding.
- **Docs and platform:** [aomi.dev/docs](https://aomi.dev/docs) · [build.aomi.dev](https://build.aomi.dev)
- **Talk to us:** [cecilia@foameo.ai](mailto:cecilia@foameo.ai) or [book a call](https://calendar.app.google/UG8dwLD8q79BfDH56).

Aomi Labs is part of Circle's Arc Acceleration Season, which is how the first target became Arc Studio apps. Aomi is not an official Circle or Arc product or integration.
