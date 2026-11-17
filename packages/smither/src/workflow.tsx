import path from "node:path";
import { existsSync } from "node:fs";
import { Fragment, type ReactNode } from "react";
import type { CreateSmithersApi } from "smithers-orchestrator";
import {
  WORKFLOW_NAME,
  agentSpecsFor,
  nodeId,
  phaseAgent,
  resolveAgentCwd,
  resolveComposition,
  type AgentPhase,
  type BuildPlan,
  type InnerPhase,
  type Phase,
} from "./plan";
import { innerPhasesOf } from "./plan";
import {
  boundedLog,
  smitherSchemas,
  type SmitherSchemas,
  type BinariesRow,
  type ClarifyRow,
  type CodegenRow,
  type GateRow,
  type ResultRow,
  type ValidationRow,
} from "./schemas";
import { packageCrate } from "./artifacts";
import { defaultRunner, resolveFreshAomiBinaries } from "./binaries";
import {
  newPackageArgs,
  runAomiBuild,
  runPackageCargoChecks,
} from "./commands";
import { makeWorkAgent, resolveAgentBilling } from "./agents";
import { rolePrompt, type PromptContext } from "./prompts";
import type { CommandRunner, ResolvedBinaries } from "./types";

export type AomiSmitherApi = CreateSmithersApi<SmitherSchemas>;
export type AomiWorkflow = ReturnType<AomiSmitherApi["smithers"]>;

/** Where the durable run state lives. `sqlite` is Bun-only (bun:sqlite);
 *  `pglite`/`postgres` run on Node — the web (`aomi-build` BFF) path. */
export type SmitherBackend =
  | { kind: "sqlite"; dbPath: string }
  | { kind: "pglite"; dataDir: string }
  | { kind: "postgres"; connectionString: string };

export function describeBackend(backend: SmitherBackend): string {
  switch (backend.kind) {
    case "sqlite":
      return backend.dbPath;
    case "pglite":
      return `pglite:${backend.dataDir}`;
    case "postgres":
      return "postgres";
  }
}

const SMITHER_META = {
  readableName: "Aomi Smither",
  description:
    "Composes a Smithers workflow from user intent: deterministic Rust codegen, multi-agent curation, clarify pauses, validate/repair loops.",
};

export async function createAomiSmither(
  backend: string | SmitherBackend,
): Promise<AomiSmitherApi> {
  const resolved: SmitherBackend =
    typeof backend === "string" ? { kind: "sqlite", dbPath: backend } : backend;
  if (resolved.kind === "sqlite") {
    const { createSmithers } = await import("smithers-orchestrator");
    return createSmithers(smitherSchemas, {
      ...SMITHER_META,
      dbPath: resolved.dbPath,
    });
  }
  const { createSmithersPostgres } = await import("smithers-orchestrator");
  return createSmithersPostgres(
    smitherSchemas,
    resolved.kind === "pglite"
      ? { ...SMITHER_META, provider: "pglite", dataDir: resolved.dataDir }
      : {
          ...SMITHER_META,
          provider: "postgres",
          connectionString: resolved.connectionString,
        },
  );
}

export type WorkflowDeps = {
  runner?: CommandRunner;
  env?: NodeJS.ProcessEnv;
};

/** Output table for a phase. Classic roles keep their bespoke tables (node
 *  ids and resume depend on it); composed roles share `agentWork`. */
function outputKeyFor(phase: InnerPhase | Phase): keyof SmitherSchemas {
  switch (phase.kind) {
    case "compute":
      switch (phase.op) {
        case "binaries":
          return "binaries";
        case "codegen":
          return "codegen";
        case "validate":
          return "validation";
        case "result":
          return "result";
      }
      break;
    case "agent":
      switch (phase.role) {
        case "curate":
          return "curation";
        case "review":
          return "review";
        case "fix":
          return "fix";
        default:
          return "agentWork";
      }
    case "wait-external":
      return "external";
    case "clarify":
      return "clarify";
    case "gate":
      return "gate";
    case "loop":
      return "validation";
    case "parallel":
      // Parallel has no output row of its own; done is derived from its
      // branches. Never read directly.
      return "result";
  }
}

type PhaseState = {
  phase: Phase;
  done: boolean;
  /** settled = done, or a decided-but-denied gate, or skipped downstream of a
   *  denied gate. The result phase mounts on settled; everything else on done. */
  settled: boolean;
  skipped: boolean;
};

/**
 * Render the task graph from `resolveComposition(plan)`. The graph is a pure
 * function of (plan, persisted outputs): phase N mounts when phases 0..N-1 are
 * done, so resume re-renders straight past completed work. Node ids come from
 * `nodeId(packageName, phase.id)` and must stay stable across renders.
 */
export async function buildPackageWorkflow(
  api: AomiSmitherApi,
  plan: BuildPlan,
  deps: WorkflowDeps = {},
): Promise<AomiWorkflow> {
  const {
    Workflow,
    Task,
    Approval,
    Sequence,
    Loop,
    Parallel,
    Signal,
    smithers,
    outputs,
  } = api;
  const runner = deps.runner ?? defaultRunner;
  const id = (stage: string) => nodeId(plan.packageName, stage);
  const composition = resolveComposition(plan);

  const resolveRepo = (repo?: string) => resolveAgentCwd(plan, repo);
  const agentKey = (name: "claude" | "codex", cwd: string) => `${name}::${cwd}`;

  // One CLI agent instance per distinct (agent, repo) used anywhere in the
  // composition — cross-repo agents run in another codebase entirely.
  // Billing: SMITHER_OPENROUTER_API_KEY (default, cheap Kimi via OpenRouter's
  // Anthropic-compatible endpoint) > SMITHER_ANTHROPIC_API_KEY (backup) >
  // local CLI login.
  const billing = resolveAgentBilling(deps.env);
  const agents = new Map<string, Awaited<ReturnType<typeof makeWorkAgent>>>();
  for (const spec of agentSpecsFor(plan)) {
    agents.set(
      agentKey(spec.name, spec.cwd),
      await makeWorkAgent(spec.name, {
        cwd: spec.cwd,
        env: deps.env,
        billing,
      }),
    );
  }

  return smithers((ctx) => {
    const row = <K extends keyof SmitherSchemas>(key: K, phaseId: string) =>
      ctx.outputMaybe(outputs[key as keyof typeof outputs], {
        nodeId: id(phaseId),
      }) as Record<string, unknown> | undefined;

    // --- well-known rows the step functions depend on -----------------------
    const findCompute = (op: string): InnerPhase | undefined => {
      for (const phase of composition) {
        for (const p of innerPhasesOf(phase)) {
          if (p.kind === "compute" && p.op === op) return p;
        }
      }
      return undefined;
    };
    const binariesPhase = findCompute("binaries");
    const binaries = binariesPhase
      ? (row("binaries", binariesPhase.id) as BinariesRow | undefined)
      : undefined;

    const latestValidationFor = (loop: Extract<Phase, { kind: "loop" }>) => {
      const validate = loop.body.find(
        (p) => p.kind === "compute" && p.op === "validate",
      );
      return validate
        ? (ctx.latest(outputs.validation, id(validate.id)) as
            | ValidationRow
            | undefined)
        : undefined;
    };
    // Current iteration count for a loop node — lets a `return-last` loop that
    // maxed out (never passed) still settle so the composition can continue.
    const loopIteration = (loopId: string): number =>
      (ctx as { iterations?: Record<string, number> }).iterations?.[
        id(loopId)
      ] ?? 0;
    const loopDone = (loop: Extract<Phase, { kind: "loop" }>): boolean => {
      const passed = !!latestValidationFor(loop)?.green;
      if (passed) return true;
      // A graceful loop also settles once it has spent its budget: `iterations`
      // is the 0-indexed current iteration, so the final round is maxRounds-1.
      // The enclosing <Sequence> still holds downstream tasks until the loop
      // node itself completes, so flipping here during the last round is safe.
      return (
        loop.onMax === "return-last" &&
        loopIteration(loop.id) >= loop.maxRounds - 1
      );
    };

    // Boolean columns round-trip through the store as 0/1 (SQLite storage
    // model, mirrored on Postgres), so ok/green/approved checks must be
    // truthiness, never `=== true`.
    const okRow = (r: Record<string, unknown> | undefined): boolean =>
      !!r && Boolean((r as { ok?: unknown }).ok);

    // Whether every leaf of a parallel phase has produced its row.
    const leafDone = (p: InnerPhase): boolean => {
      switch (p.kind) {
        case "compute":
          return (
            !!row(outputKeyFor(p), p.id) &&
            (p.op === "codegen" ? okRow(row(outputKeyFor(p), p.id)) : true)
          );
        case "agent":
          return !!row(outputKeyFor(p), p.id);
        case "clarify":
          return plan.autoApprove || !!row("clarify", p.id);
        case "gate":
          return !!(row("gate", p.id) as GateRow | undefined)?.approved;
      }
    };

    // --- clarify answers become prompt context for later agent phases -------
    const clarifications: NonNullable<PromptContext["clarifications"]> = [];
    for (const phase of composition) {
      if (phase.kind !== "clarify") continue;
      if (plan.autoApprove) {
        clarifications.push({
          question: phase.question,
          selected: phase.options[0].key,
          notes: "auto-selected (--yes)",
        });
        continue;
      }
      const decision = row("clarify", phase.id) as ClarifyRow | undefined;
      if (decision) {
        clarifications.push({
          question: phase.question,
          selected: decision.selected,
          notes: decision.notes,
        });
      }
    }

    // --- walk the composition: done/settled per phase ------------------------
    const states: PhaseState[] = [];
    let denialUpstream = false;
    let gateDenied = false;
    for (const phase of composition) {
      const isResult = phase.kind === "compute" && phase.op === "result";
      if (denialUpstream && !isResult) {
        states.push({ phase, done: false, settled: true, skipped: true });
        continue;
      }
      let done = false;
      switch (phase.kind) {
        case "compute": {
          const r = row(outputKeyFor(phase), phase.id);
          done = !!r && (phase.op === "codegen" ? okRow(r) : true);
          break;
        }
        case "agent":
          done = !!row(outputKeyFor(phase), phase.id);
          break;
        case "wait-external":
          // The Signal node records the received payload into `external`.
          done = !!row("external", phase.id);
          break;
        case "clarify":
          done = plan.autoApprove || !!row("clarify", phase.id);
          break;
        case "gate": {
          const decision = row("gate", phase.id) as GateRow | undefined;
          done = !!decision?.approved;
          if (decision && !decision.approved) {
            denialUpstream = true;
            gateDenied = true;
          }
          break;
        }
        case "loop":
          done = loopDone(phase);
          break;
        case "parallel":
          done = phase.branches.every((branch) => branch.every(leafDone));
          break;
      }
      states.push({
        phase,
        done,
        settled: done || (phase.kind === "gate" && denialUpstream),
        skipped: false,
      });
    }

    const mountable = (index: number): boolean => {
      const state = states[index];
      if (state.skipped) return false;
      const isResult =
        state.phase.kind === "compute" && state.phase.op === "result";
      return states
        .slice(0, index)
        .every((prev) => (isResult ? prev.settled : prev.done));
    };

    // --- render one phase ----------------------------------------------------
    const renderInner = (
      phase: InnerPhase,
      loopContext?: {
        latestValidation?: ValidationRow;
      },
    ): ReactNode => {
      switch (phase.kind) {
        case "compute":
          return renderCompute(phase);
        case "agent": {
          if (phase.onlyIf === "prev-red") {
            const validation = loopContext?.latestValidation;
            if (!validation || validation.green) return null;
          }
          const agentPhase = phase as AgentPhase;
          const agent = agents.get(
            agentKey(phaseAgent(plan, phase), resolveRepo(agentPhase.repo)),
          );
          if (!agent) return null;
          const context: PromptContext & { validationLog?: string } = {
            brief: phase.brief,
            clarifications,
            validationLog: loopContext?.latestValidation?.log,
          };
          return (
            <Task
              id={id(phase.id)}
              label={
                phase.label ?? `${phase.role} (${phaseAgent(plan, phase)})`
              }
              output={outputs[outputKeyFor(phase) as "curation"]}
              agent={agent}
              needsApproval={phase.role === "curate" && !plan.autoApprove}
            >
              {rolePrompt(phase.role, plan, context)}
            </Task>
          );
        }
        case "clarify": {
          if (plan.autoApprove) return null;
          return (
            <Approval
              id={id(phase.id)}
              mode="select"
              options={phase.options.map((o) => ({
                key: o.key,
                label: o.label,
                ...(o.summary ? { summary: o.summary } : {}),
              }))}
              output={outputs.clarify}
              request={{
                title: phase.question,
                ...(phase.summary ? { summary: phase.summary } : {}),
                // Mirror the options into request metadata so every surface
                // (TUI events, gateway console) can render them from the
                // request alone.
                metadata: { clarify: true, options: phase.options },
              }}
              onDeny="continue"
            />
          );
        }
        case "gate":
          return (
            <Approval
              id={id(phase.id)}
              output={outputs.gate}
              request={{
                title: phase.title,
                ...(phase.summary ? { summary: phase.summary } : {}),
              }}
              onDeny="continue"
            />
          );
      }
    };

    const renderCompute = (
      phase: Extract<InnerPhase, { kind: "compute" }>,
    ): ReactNode => {
      const label = phase.label;
      switch (phase.op) {
        case "binaries":
          return (
            <Task
              id={id(phase.id)}
              label={label ?? "Sync SDK from GitHub, build aomi binaries"}
              output={outputs.binaries}
              noRetry
            >
              {() => syncBinariesStep(plan, runner)}
            </Task>
          );
        case "codegen":
          return binaries ? (
            <Task
              id={id(phase.id)}
              label={label ?? "aomi-build codegen"}
              output={outputs.codegen}
              noRetry
            >
              {() => codegenStep(plan, toResolvedBinaries(binaries), runner)}
            </Task>
          ) : null;
        case "validate":
          return (
            <Task
              id={id(phase.id)}
              label={label ?? "cargo fmt/clippy/test"}
              output={outputs.validation}
              noRetry
            >
              {() => validationStep(plan, runner)}
            </Task>
          );
        case "result":
          return (
            <Task
              id={id(phase.id)}
              label={label ?? "Summarize run"}
              output={outputs.result}
              noRetry
            >
              {() => resultStep(plan, runner)}
            </Task>
          );
      }
    };

    const renderPhase = (phase: Phase, index: number): ReactNode => {
      if (!mountable(index)) return null;
      if (phase.kind === "loop") {
        const latestValidation = latestValidationFor(phase);
        const until = !!latestValidation?.green;
        return (
          <Loop
            id={id(phase.id)}
            until={until}
            maxIterations={phase.maxRounds}
            onMaxReached={
              phase.onMax === "return-last" ? "return-last" : "fail"
            }
          >
            <Sequence>
              {phase.body.map((inner) => (
                <Fragment key={inner.id}>
                  {renderInner(inner, { latestValidation })}
                </Fragment>
              ))}
            </Sequence>
          </Loop>
        );
      }
      if (phase.kind === "parallel") {
        return (
          <Parallel
            id={id(phase.id)}
            {...(phase.maxConcurrency
              ? { maxConcurrency: phase.maxConcurrency }
              : {})}
          >
            {phase.branches.map((branch, branchIndex) => (
              <Sequence key={`${phase.id}-b${branchIndex}`}>
                {branch.map((inner) => (
                  <Fragment key={inner.id}>{renderInner(inner)}</Fragment>
                ))}
              </Sequence>
            ))}
          </Parallel>
        );
      }
      if (phase.kind === "wait-external") {
        // Durable pause: parks the run (status waiting-event) until a signal
        // keyed by this node id arrives (sendSignal / console /signal / CLI
        // signal). The Signal validates + records the payload into `external`.
        return (
          <Signal
            id={id(phase.id)}
            schema={smitherSchemas.external}
            {...(phase.timeoutHours
              ? { timeoutMs: phase.timeoutHours * 3_600_000 }
              : {})}
            {...(phase.onTimeout ? { onTimeout: phase.onTimeout } : {})}
          />
        );
      }
      return renderInner(phase);
    };

    return (
      <Workflow name={`${WORKFLOW_NAME}:${plan.packageName}`}>
        <Sequence>
          {composition.map((phase, index) => (
            <Fragment key={phase.id}>{renderPhase(phase, index)}</Fragment>
          ))}
        </Sequence>
      </Workflow>
    );
  });
}

function toResolvedBinaries(row: BinariesRow): ResolvedBinaries {
  return {
    aomiBuild: row.aomiBuild,
    sdkRoot: row.sdkRoot,
    source: row.source as ResolvedBinaries["source"],
    ...(row.warning ? { warning: row.warning } : {}),
  };
}

async function syncBinariesStep(
  plan: BuildPlan,
  runner: CommandRunner,
): Promise<BinariesRow> {
  const resolved = await resolveFreshAomiBinaries(plan.sdkRoot, runner, {
    allowStale: plan.allowStaleSdk,
  });
  return {
    aomiBuild: resolved.aomiBuild,
    sdkRoot: resolved.sdkRoot,
    source: resolved.source,
    headSha: resolved.freshness.headSha ?? "",
    syncAction: resolved.freshness.action,
    warning: resolved.warning ?? "",
  };
}

async function codegenStep(
  plan: BuildPlan,
  binaries: ResolvedBinaries,
  runner: CommandRunner,
): Promise<CodegenRow> {
  // The composing BFF may not share a filesystem with the executor (sandbox
  // plans always compose as "discover" because the server can't stat the
  // image's packages/) — re-derive the source where the filesystem actually is:
  // an package whose curated sources exist behaves as "existing".
  const toolPath = path.join(
    plan.sdkRoot,
    "packages",
    plan.packageName,
    "src",
    "tool.rs",
  );
  const source =
    plan.source !== "existing" && existsSync(toolPath)
      ? "existing"
      : plan.source;
  // Idempotence: a re-run (e.g. a deploy-only pass) must not clobber sources
  // an agent already curated. gen-* only runs when the package has no sources yet.
  if (source === "existing" && !plan.force) {
    if (existsSync(toolPath)) {
      return {
        ok: true,
        log: `kept existing generated + curated sources (packages/${plan.packageName}/src); pass --force to regenerate`,
      };
    }
  }
  const results =
    source === "existing"
      ? [
          await runAomiBuild(
            binaries,
            "gen-client",
            [
              plan.packageName,
              ...(plan.shared ? ["--shared"] : []),
              ...(plan.force ? ["--force"] : []),
            ],
            runner,
          ),
          await runAomiBuild(
            binaries,
            "gen-tool",
            [
              plan.packageName,
              ...(plan.shared ? ["--shared"] : []),
              // Always `--all`: the interactive operation picker cannot run
              // under the workflow runner (no TTY); the curation agent prunes.
              "--all",
              ...(plan.force ? ["--force"] : []),
            ],
            runner,
          ),
        ]
      : [
          await runAomiBuild(
            binaries,
            "new-package",
            newPackageArgs({
              packageName: plan.packageName,
              source: plan.source,
              openApiUrl: plan.openApiUrl,
              shared: plan.shared,
              includeAllOperations: true,
              force: plan.force,
              build: plan.build,
            }).slice(1),
            runner,
          ),
        ];
  const failed = results.find((result) => result.exitCode !== 0);
  if (failed) {
    const output = failed.stderr || failed.stdout;
    const hint = output.includes("Pass --force to overwrite")
      ? "\nHint: aomi-smither --overwrite only resets .smithers run state. Add --force to overwrite existing generated package files, or use --existing to reuse the current spec."
      : "";
    throw new Error(`aomi-build codegen failed: ${boundedLog(output)}${hint}`);
  }
  return {
    ok: true,
    log: boundedLog(results.map((result) => result.stdout).join("\n")),
  };
}

async function validationStep(
  plan: BuildPlan,
  runner: CommandRunner,
): Promise<ValidationRow> {
  const result = await runPackageCargoChecks(
    plan.sdkRoot,
    plan.packageName,
    runner,
  );
  return {
    green: result.exitCode === 0,
    log: boundedLog(result.stderr || result.stdout),
  };
}

async function resultStep(
  plan: BuildPlan,
  runner: CommandRunner,
): Promise<ResultRow> {
  const artifact = await packageCrate({
    sdkRoot: plan.sdkRoot,
    packageName: plan.packageName,
    runner,
  });
  return {
    status: "complete",
    summary: `${plan.packageName} built and validated.`,
    fileTreeJson: artifact.fileTreeJson,
    crateTarB64: artifact.crateTarB64,
    artifactWarning: artifact.warning,
  };
}
