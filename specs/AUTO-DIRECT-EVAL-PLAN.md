# Auto and Direct Luna Eval Plan

Status: PROPOSED FOR REVIEW (2026-09-03)

This eval plan is a release gate for
[`AUTO-DIRECT-EXECUTION-PLAN.md`](./AUTO-DIRECT-EXECUTION-PLAN.md). It extends
the existing `orchestrator_overhead` specs and suites rather than creating an
unrelated benchmark family.

## Color key

- 🟩 **Required** — correctness or safety; any failure blocks every client port.
- 🟦 **Comparison** — quantify overhead and cost; report distributions.
- 🟨 **Diagnostic** — useful routing/latency signal, not correctness alone.
- 🟥 **Forbidden** — this path must not occur.

## Method

Use `gpt-5.6-luna` for the primary matrix. Model choice belongs in the suite or
CLI invocation, not individual durable specs.

Run this matrix immediately after the backend Auto runtime passes its focused
tests. The backend eval harness can select the new runtime directly, so SDK and
CLI support are not prerequisites. After the first report, stop for product
review; do not begin SDK, CLI, widget, or Portal implementation.

Compare three paths with the same realistic prompts, wallet state, chain forks,
provider configuration, and pass count:

1. **Current default baseline** for simple/core/skill-local work.
2. **Current orchestrator baseline** for delegated/app/multi-scope work.
3. **Candidate Auto**, plus candidate Direct where Direct overhead matters.

Run at least five interleaved passes per leaf for the first review and ten for
the final go/no-go report. Use a fresh/reset test environment for mutating leaves
and record exact commits and dirty state. Preserve all output under:

```text
output/eval/auto-direct-luna/<benchmark>/<model>/pass-NNN/
```

Every run ends with `output/eval/auto-direct-luna/report.md` containing the
commands, specs, model, commits, test-env state, verdicts, and comparison tables.

## Metrics

Collect per leaf and by role (`direct`, `mother`, `child`):

- input tokens;
- cached input tokens;
- output tokens;
- visible and reasoning output tokens;
- total tokens;
- Aomi cost credits, user-charged credits, and normalized estimated cost;
- model request count;
- child count;
- tool-call count and assistant tool turns;
- time to first model output, first tool, first Action, and terminal answer;
- total wall time;
- required-assertion pass rate;
- observed route versus intended route.

The existing eval report already captures normalized usage and role-level usage
events. Extend the harness only where required to expose Auto role, child count,
Action/chain switching order, or comparable latency milestones. Do not infer
cost from transcript length when usage events are available.

### Proposed performance guardrails

Correctness is the hard gate. The following are review thresholds, reported as
median and p90 rather than single-run values:

- candidate Direct should remain within 5% of legacy Direct token/cost totals;
- non-delegating Auto should stay within the greater of 25% or 2,000 total
  tokens over the current default median;
- delegated Auto should stay within 15% of the current orchestrator median cost
  for the same successful story;
- simple/core Auto cases must create zero children, which is the strongest
  protection against accidental overhead;
- any threshold miss requires an explicit product sign-off or prompt/tool
  reduction before the Portal port.

These thresholds may be tightened after the first five-pass observation, but
must not be relaxed after seeing a regression without documenting why.

## Behavioral matrix

### A. Local mother routing

| ID  | User story                               | Required proof                                           | Forbidden proof                         |
| --- | ---------------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| A1  | Plain answer, no tools                   | Auto mother answers                                      | any `task`                              |
| A2  | Core balance/read                        | mother uses Core tool                                    | any child                               |
| A3  | One compatible skill                     | mother activates/uses skill                              | child or app                            |
| A4  | Multiple compatible skills, one chain    | mother keeps both within one valid guard scope           | child solely because count > 1          |
| A5  | Mother stages and commits one EVM action | parent pending ID, canonical EVM commit, Action callback | `commit_staged`                         |
| A6  | Mother stages SVM work                   | parent pending ID, one canonical SVM commit, callback    | multiple model-facing SVM commit routes |

Prompts must read like normal user requests and must not instruct the model to
call tools merely to satisfy assertions.

### B. Delegation and guards

| ID  | User story                                       | Required proof                                                             | Forbidden proof                            |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------ |
| B1  | Natural-language third-party app request, no `@` | exactly one child receives the correct app; mother does not load app tools | frontend-resolved route or mother app call |
| B2  | Same request with an `@app` hint                 | hint influences selection but backend validation remains authoritative     | hint treated as permission                 |
| B3  | Two apps                                         | one scoped child per app, serial task events                               | one child with two app scopes              |
| B4  | Incompatible skill guards                        | mother delegates isolated compatible scopes with correct skill IDs/chain   | weakened guard or wrong-chain tool         |
| B5  | Explicit specialist request                      | requested child exists and reports back                                    | mother silently ignores request            |
| B6  | Complex task that benefits from isolation        | child used once with a complete work order                                 | unnecessary child loop                     |
| B7  | Direct app equivalent                            | zero task events and only selected app tools                               | orchestrator tools exposed                 |

Also retain the positive counterexample: compatible multi-skill work stays in
the mother. The policy is guard-driven isolation, not “more than one skill means
delegate.”

### C. Parent adoption and commit ownership

| ID  | User story                                            | Required proof                                                                                |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| C1  | Child stages one EVM tx                               | child cannot commit; host adopts with a new parent ID; mother calls canonical EVM commit      |
| C2  | Child stages one SVM intent                           | child cannot commit; host adopts; mother calls canonical SVM commit                           |
| C3  | Mother and child each stage on one EVM chain          | final commit resolves both parent IDs in the requested order and emits one homogeneous Action |
| C4  | Two children stage same-chain transfers               | two adoptions, one optional parent simulation, one EVM Action, exact recipient deltas         |
| C5  | Child simulates, mother does not re-simulate          | commit succeeds; child simulation is evidence, not eligibility                                |
| C6  | Child does not simulate, mother simulates adopted IDs | simulation and commit succeed                                                                 |
| C7  | Neither side simulates a safe fixture                 | canonical commit is not blocked by a missing verdict                                          |
| C8  | Replay the same child completion/task call            | adoption is idempotent; no duplicate pending ID or send                                       |

Every execution case requires callback or chain-state evidence before the final
answer may claim success.

### D. Chain switching — mother only

| ID  | User story                                         | Required proof                                                                                                                          |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Two EVM transfers on two chains                    | mother stages explicit chain IDs, emits two chain-homogeneous Actions, client `switchChain` order matches, each callback resumes mother |
| D2  | Start connected to chain A but act only on chain B | target-chain skill/guard resolution uses B; one wallet switch before send                                                               |
| D3  | EVM action then SVM action                         | EVM and SVM capabilities are selected separately; `switchChain`/`switchCluster` and callbacks occur in order                            |
| D4  | Two SVM clusters where supported                   | separate cluster-homogeneous Actions and explicit `switchCluster` order                                                                 |
| D5  | Wallet lacks switch capability                     | Action fails clearly, no false success, unrelated pending state remains                                                                 |
| D6  | Model attempts a mixed-chain EVM commit            | kernel rejects it; mother splits and retries safely or reports the boundary                                                             |

The mother may change target chain within one turn, but no assertion should
pretend that staging itself changed the browser wallet.

### E. Chain switching — child assisted

| ID  | User story                                                 | Required proof                                                                                         |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| E1  | Child app stages on a chain different from connected chain | task carries target `chain_id`; adopted parent record retains it; mother commit triggers client switch |
| E2  | Two children stage on two EVM chains                       | each child has one chain scope; parent creates two Actions; switch/callback order is exact             |
| E3  | Mother stages chain A and child stages chain B             | shared parent queue, separate homogeneous commits, both callbacks return to one mother                 |
| E4  | Child EVM leg followed by child SVM leg                    | correct app/skill/wallet family per child and canonical parent commits                                 |
| E5  | Guard rejects the requested child chain                    | no staging or commit on a fallback chain; error is surfaced or a valid child scope is selected         |

These cases are required even if D1–D6 pass; child context propagation and
parent adoption can lose chain identity independently of mother-only behavior.

### F. Hints and frontend independence

| ID  | User story                               | Required proof                                                    |
| --- | ---------------------------------------- | ----------------------------------------------------------------- |
| F1  | No tags, obvious app intent              | correct app delegation from natural language                      |
| F2  | Correct app/skill/chain tags             | same safe resolution as equivalent natural language               |
| F3  | Incompatible hint                        | backend rejects/ignores safely and explains; no unauthorized tool |
| F4  | Misleading label with stable ID mismatch | stable ID/entitlement wins; label is not authority                |
| F5  | Auto mode with no refs                   | no frontend-created scopes are needed                             |

### G. Legacy compatibility

| ID  | Input                               | Required proof                             |
| --- | ----------------------------------- | ------------------------------------------ |
| G1  | omitted mode + `app: default`       | current default behavior                   |
| G2  | omitted mode + `app: orchestrator`  | legacy restricted orchestrator still works |
| G3  | omitted mode + existing dynamic app | current direct app behavior                |
| G4  | explicit Auto + app identity        | pre-turn validation error                  |
| G5  | explicit Direct without app         | builtin default runtime, zero children     |
| G6  | explicit Direct with one app        | direct path, zero children                 |
| G7  | omitted mode and omitted identity   | Auto runtime                               |

## Later SDK and CLI E2E criteria

These criteria are intentionally deferred until the user approves the backend
benchmark. They are retained here so the later client phase uses the same
behavioral contract. Before Portal work, run built artifacts—not source-only
mocks—against the paired local backend:

- SDK `Aomi.agent.run()` defaults to Auto and emits the explicit mode field.
- SDK Direct supports a selected app or no identity for the builtin default runtime.
- CLI default, `--mode auto`, untargeted `--mode direct`, and `--mode direct --app ...` reach the intended
  backend runtime.
- CLI invalid combinations fail locally before a network request.
- REPL mode/target survives another turn and session resume.
- verbose CLI prints child activity only when Auto actually delegates.
- Direct never prints child activity.
- mother and child Action results use the normal ActionHandler callback path.
- sequential cross-chain Actions reach the correct provider; if a local RPC map
  is required, it is implemented as a general client capability rather than an
  eval-only exception.

## Assertion strategy

Use current code-grounded assertions where available:

- `tool` assertions with `role: mother|child|direct`;
- exact task counts and selected `app`, `application_id`, `skills`, and
  `chain_id` arguments;
- zero-count assertions for forbidden tools, especially `task` in Direct and
  commit tools in children;
- pending transaction shape and parent ID/provenance observations;
- wallet Action/event observations with homogeneous chain/cluster payloads;
- callback observations for every Action;
- balance deltas and event logs for mutating EVM stories;
- maximum tool calls and assistant tool turns as loop warnings;
- explicit switch-order observations added to the harness if not currently
  reportable.

Do not preserve old requirements that every child must simulate or that the
mother must call `commit_staged`; those are regression assertions for behavior
being deleted.

## Deliverables

- durable specs under `product-mono/aomi/bin/eval/specs/auto_direct/`;
- one interleaved Luna suite under `product-mono/aomi/bin/eval/suites/`;
- retained baseline specs or pinned baseline JSON from the pre-change commit;
- `output/eval/auto-direct-luna/report.md` with behavior and overhead tables;
- a short list of harness gaps fixed to make parent/child chain switching
  observable;
- exact commands, commits, dirty state, model, provider, test-env chains, and
  pass count.

After the first five-pass backend run, stop and present the report. SDK, CLI,
widget, and frontend work is unblocked only by explicit user approval; green
assertions alone do not authorize the next phase.
