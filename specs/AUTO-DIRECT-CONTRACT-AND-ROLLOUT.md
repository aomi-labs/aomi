# Auto and Direct Contract and Rollout

Status: rollout plan; wire/SDK contract synchronized with implementation (2026-09-07).
The remaining checklist records the original rollout gates.

This is the implementation checklist for
[`AUTO-DIRECT-EXECUTION-PLAN.md`](./AUTO-DIRECT-EXECUTION-PLAN.md). It makes the
backend-first order and verification gates explicit.

## 🟦 Workspace

The existing logical workspace is already paired; do not create a second
backend worktree.

| Role         | Checkout                                  | Branch                      | Starting commit |
| ------------ | ----------------------------------------- | --------------------------- | --------------- |
| Frontend/SDK | `.worktrees/portal-ui-local/aomi`         | `feat/wallet-management-ui` | `91c2b8e1`      |
| Backend      | `.worktrees/portal-ui-local/product-mono` | `work/portal-ui-local`      | `860fc4c9`      |

The workspace manager points to both exact paths and the standard local runtime
is healthy. Its stored frontend branch label is stale from before the checkout
changed branches; this is metadata drift, not a missing attachment.

## 🟩 Public wire contract

Extend the existing Agent `StartTurnIntent` minimally:

```ts
type StartTurnIntent = {
  // existing fields
  message: string;
  app?: string | null;
  applicationId?: number | null;

  // new
  mode?: "auto" | "direct" | null;
};
```

Server validation matrix:

| `mode`   | app identity                        | Meaning                                      |
| -------- | ----------------------------------- | -------------------------------------------- |
| omitted  | omitted                             | Auto runtime                                 |
| omitted  | `app` or `applicationId`            | Legacy direct selection                      |
| `auto`   | omitted                             | New Auto mother                              |
| `auto`   | present                             | Reject as ambiguous                          |
| `direct` | exactly one resolvable app identity | Direct selected app                          |
| `direct` | omitted                             | Builtin default runtime, without child tools |
| `direct` | conflicting identifiers             | Reject before starting                       |

For hosted apps, `applicationId` is authoritative and an optional `app` is an
exact-name consistency check. Builtins can use `app`. The internal Auto AppSpec
is selected through `mode: "auto"`, not by encouraging callers to send
`app: "auto"`.

The backend lands before any client emits `mode`, because `TurnRequest` uses
`deny_unknown_fields`.

## 🟩 Phase 1 — backend and runtime

### Runtime construction

- [ ] Add `AppSpec::auto()` with default EVM/SVM/Core namespaces plus
      orchestration tools.
- [ ] Keep skill discovery and activation enabled in Auto.
- [ ] Replace name-string capability checks with an explicit runtime role or
      capability predicate.
- [ ] Permit `task` and `sleep` for Auto and legacy orchestrator only.
- [ ] Keep Direct/default/dynamic app runtimes free of child tools.
- [ ] Write the compact Auto preamble and focused preamble snapshot tests.
- [ ] Ensure active-parent timeout accounting pauses only while a foreground
      child owns work.
- [ ] Classify Auto requests consistently in usage/latency telemetry as mother
      work, including Auto turns that choose not to delegate.

Primary backend ownership:

- `aomi/crates/core/src/resource/spec.rs`
- `aomi/crates/core/src/app/builder/`
- `aomi/crates/core/src/completion/mod.rs`
- `aomi/crates/core/src/call_consumer/`
- `aomi/crates/runtime/src/thread.rs`
- `aomi/crates/runtime/src/child_task/`

### Parent staging and commits

- [ ] Retain crash-safe child adoption and parent-owned ID allocation.
- [ ] Make ordinary EVM and SVM commit tools resolve both mother-created and
      adopted child IDs.
- [ ] Delete `commit_staged`, `CommitStagedBatch`, staged simulation verdicts,
      blockers, and orchestrator commit wrapping.
- [ ] Keep provenance so traces and evals can distinguish mother/child origin.
- [ ] Remove simulation as a commit precondition.
- [ ] Preserve optional ID-based simulation for children and the mother.
- [ ] Expose one model-facing SVM commit tool; store enough assembly/broadcast
      metadata with staged SVM work to dispatch internally.
- [ ] Keep legacy SVM tool aliases host-internal only if artifact compatibility
      requires them; do not expose multiple SVM commit choices to Auto.

Primary backend ownership:

- `aomi/crates/pipeline/src/user_state/orchestration.rs`
- `aomi/crates/tools/src/user_state/`
- `aomi/crates/tools/src/ethereum/tx/`
- `aomi/crates/tools/src/svm/`
- `aomi/crates/core/src/child_task.rs`

### Chain and skill scope

- [ ] Make skill activation accept the intended target chain rather than only
      the wallet chain captured at turn start.
- [ ] Keep per-tool `chain_id` user-state scoping and guard evaluation.
- [ ] Allow one mother to stage multiple chain scopes without pretending the
      browser wallet already switched.
- [ ] Require homogeneous signer/chain or payer/cluster per Action.
- [ ] Resume the mother after each callback before committing another chain.
- [ ] Preserve pending work after an unsupported/missing switch result.
- [ ] Delegate only guard-incompatible skill scopes; compatible multi-skill work
      remains local.

### API and compatibility

- [ ] Add `mode` to `aomi_pipeline::agent::TurnRequest` and validation.
- [ ] Route explicit Auto to the new AppSpec.
- [ ] Route explicit Direct to the selected builtin/hosted app, or builtin default when untargeted.
- [ ] Keep the existing `/v1/agent/chat` endpoint and idempotency behavior.
- [ ] Keep legacy app selection and the legacy orchestrator runtime working.
- [ ] Update route/request tests and regenerate the Agent OpenAPI contract.
- [ ] Reject ambiguous Auto/app and conflicting hosted identifiers; verify untargeted Direct selects default.

### Backend green gate

Do not start the TypeScript port until all of these are true:

- [ ] focused Core/runtime/pipeline/tool tests pass;
- [ ] route manifest and OpenAPI tests pass;
- [ ] direct, Auto-local, Auto-child, adoption, commit, and callback integration
      tests pass;
- [ ] mother-only and child-assisted two-chain tests pass;
- [ ] legacy default, orchestrator, and direct-app fixtures pass;
- [ ] `cargo fmt --all -- --check` passes;
- [ ] targeted Clippy runs with warnings denied.

## 🟩 Phase 2 — backend Luna benchmark and mandatory review stop

As soon as the backend green gate passes, implement only the harness/spec work
needed to run the backend through the matrix in
[`AUTO-DIRECT-EVAL-PLAN.md`](./AUTO-DIRECT-EVAL-PLAN.md). Do not wait for the
TypeScript SDK or CLI.

- [ ] Capture current `default` and `orchestrator` baseline evidence from a
      pinned pre-change backend commit or preserved reports.
- [ ] Run the five-pass interleaved `gpt-5.6-luna` review matrix.
- [ ] Cover Auto-local, Auto-child, parent adoption/commit, guard-driven skill
      delegation, and mother-only plus child-assisted chain switching.
- [ ] Report token, credit, request, child, tool, and latency distributions.
- [ ] Identify any material compromise in cost, latency, routing reliability,
      tool availability, or prompt size.
- [ ] Write `output/eval/auto-direct-luna/report.md` with exact commands,
      commits, environment, and failures.

### Mandatory review stop

After the first backend benchmark report:

- [ ] stop implementation;
- [ ] present the backend diff and Luna results to the user;
- [ ] do not modify the TypeScript SDK, CLI, widget, or Portal;
- [ ] resume only after explicit approval of the measured tradeoff or a
      user-requested backend/prompt revision.

## 🟩 Phase 3 — TypeScript SDK, only after review approval

Expose a discriminated target while flattening it onto the wire contract:

```ts
type AgentTarget =
  | { mode?: "auto" }
  | { mode: "direct"; applicationId?: number; app?: string };

type SessionOptions = {
  target?: AgentTarget;
  // legacy app/applicationId remain temporarily
};
```

- [ ] Add the generated `mode` field from backend OpenAPI.
- [ ] Make high-level `Aomi.agent.run()` and new `ClientSession` usage default
      to `{ mode: "auto" }`.
- [ ] Validate Direct cardinality before sending.
- [ ] Preserve legacy `app` and `applicationId` options with deprecation docs,
      not a silent semantic rewrite.
- [ ] Keep ActionHandler as the only EVM/SVM execution and callback owner.
- [ ] Test EVM `switchChain` and SVM `switchCluster` order for sequential
      Actions from the same mother.
- [ ] Verify mixed-chain Actions are rejected while sequential homogeneous
      Actions succeed.
- [ ] Patch-bump changed publishable packages, rebuild declarations/artifacts,
      refresh the lockfile if required, and inspect the packed tarball.

Primary frontend ownership:

- `packages/client/src/agent/`
- `packages/client/src/session/`
- `packages/client/src/sdk/agent.ts`
- `packages/client/src/wallet/capabilities.ts`
- generated Agent v1 types and contract tests

### SDK green gate

- [ ] transport tests prove the exact Auto and Direct JSON bodies;
- [ ] type tests reject illegal target combinations;
- [ ] session/action tests prove chain switch, Action, callback, and resume order;
- [ ] client typecheck, tests, build, and package dry-run pass;
- [ ] one updated SDK smoke against the local backend completes Auto-local and
      Direct-app turns.

## 🟩 Phase 4 — TypeScript CLI, only after review approval

User surface:

```text
aomi chat "show my Base ETH balance"                  # Auto (default)
aomi chat --mode auto "show my Base ETH balance"      # explicit Auto
aomi chat --mode direct "..."                         # builtin default
aomi chat --mode direct --app zerox "quote ETH/USDC"  # selected Direct
aomi chat --mode direct --application-id 42 "..."     # hosted Direct
```

CLI compatibility and persistence:

- [ ] add global `--mode auto|direct`;
- [ ] no mode and no app uses Auto in the updated CLI;
- [ ] explicit Direct accepts `--app` or `--application-id`, defaulting to the builtin default runtime when neither is selected;
- [ ] explicit Auto plus an app selector is a clear CLI error;
- [ ] `--app` without `--mode` retains legacy direct behavior;
- [ ] persist the selected mode and Direct target with the active session;
- [ ] add `/mode auto` and `/mode direct [app]` to the REPL;
- [ ] keep `/app <name>` as a compatibility shorthand for Direct;
- [ ] show the current mode and Direct app in status/help/JSON output;
- [ ] keep wallet `--aa`/`--eoa` and `--aa-mode` concepts distinct from agent
      routing mode in internal TypeScript names.

Because CLI wallet capabilities already expose logical EVM/SVM switching, add
coverage that sequential Actions update the active chain/cluster and use the
correct provider. If one `--rpc-url` cannot represent a multi-chain local test,
introduce a chain-ID provider resolver rather than special-casing the eval.

### CLI green gate

- [ ] parser/help/snapshot tests pass;
- [ ] invalid mode/app combinations exit once with actionable text;
- [ ] one-shot and REPL persistence tests pass;
- [ ] built CLI against the local backend proves Auto default, explicit Auto,
      Direct builtin, and Direct hosted identity;
- [ ] a local multi-chain smoke proves sequential mother Actions use the
      intended chains or records the missing provider resolver as a blocker;
- [ ] SDK and CLI green gates are recorded before any Portal port begins.

## 🟩 Phase 5 — widget and Portal

Port the committed UI foundation only after the backend benchmark review is
approved and the SDK and CLI gates pass:

- [ ] replace Auto/Direct/Coordinate with Auto/Direct;
- [ ] remove frontend `resolvedMode` routing and any deterministic partitioning;
- [ ] keep `@` selections as bounded hints only;
- [ ] send the SDK target contract rather than model instructions hidden in a
      user message where a typed mode/app field exists;
- [ ] reveal the direct app dropdown only when Direct is selected;
- [ ] add widget routing configuration and fixed-direct behavior;
- [ ] keep Working and existing child rows;
- [ ] retain historical event-derived traces when mode changes;
- [ ] add component, runtime, accessibility, and host-configuration tests;
- [ ] rebuild publishable widget/React artifacts and apply required version
      bumps once for the final shipping change.

The final browser pass is intentionally user-reviewed after automated Portal and
widget checks are green.
