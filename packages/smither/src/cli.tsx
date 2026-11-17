import path from "node:path";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, render, useApp } from "ink";
import { ConfirmInput, Select, TextInput } from "@inkjs/ui";
import type { SmithersEvent } from "smithers-orchestrator";
import {
  buildPlanSchema,
  describePlan,
  finalizePlan,
  mergePlanDraft,
  stageKeyForNode,
  stagesFor,
  type BuildPlan,
  type PlanStage,
} from "./plan";
import type { IntentTurn } from "./prompts";
import { distillIntent, type IntentAgent } from "./intent";
import { defaultRunner, defaultSdkRoot } from "./binaries";
import type { CommandRunner } from "./types";
import { defaultRunsRoot } from "./state";
import {
  decideApproval,
  executeRunUntilSettled,
  prepareRun,
  type PreparedRun,
} from "./run";
import {
  startConsole,
  startConsoleForApp,
  type ConsoleHandle,
} from "./console";
import { startIntakeServer, type IntakeServerHandle } from "./intake";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

type CliArgs = {
  help: boolean;
  yes: boolean;
  dryRun: boolean;
  overwrite: boolean;
  runsRoot: string;
  intentAgent: IntentAgent;
  /** Browser console sidecar. Unset ⇒ on for interactive runs, off for
   *  headless ones (scripts/CI must opt in with --console). */
  console?: boolean;
  consolePort?: number;
  /** Force the built-in Smithers operator console over the aomi-branded UI. */
  consoleBuiltin: boolean;
  /** Plan fields provided via flags; the chat fills in the rest. */
  draft: Partial<BuildPlan>;
  provided: Set<string>;
};

function parseFlagMap(argv: string[]): Map<string, string | boolean> {
  const values = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, true);
    } else {
      values.set(key, next);
      i += 1;
    }
  }
  return values;
}
function stringValue(
  values: Map<string, string | boolean>,
  key: string,
): string | undefined {
  const value = values.get(key);
  return typeof value === "string" ? value : undefined;
}

function parseArgs(argv: string[]): CliArgs {
  const values = parseFlagMap(argv);
  const draft: Partial<BuildPlan> = {
    sdkRoot: path.resolve(stringValue(values, "sdk-root") ?? defaultSdkRoot()),
  };
  const provided = new Set<string>();
  const setField = <K extends keyof BuildPlan>(
    key: K,
    value: BuildPlan[K] | undefined,
  ) => {
    if (value === undefined) return;
    draft[key] = value;
    provided.add(key);
  };

  setField("packageName", stringValue(values, "package"));
  const openApiUrl = stringValue(values, "openapi-url");
  if (openApiUrl) {
    setField("openApiUrl", openApiUrl);
    setField("source", "url");
  }
  if (values.get("existing")) setField("source", "existing");
  if (values.get("shared")) setField("shared", true);
  if (values.get("force")) setField("force", true);
  if (values.get("no-build")) setField("build", false);
  setField("userStory", stringValue(values, "user-story"));
  const builder =
    stringValue(values, "builder") ?? stringValue(values, "agent");
  if (builder === "claude" || builder === "codex" || builder === "none") {
    setField("builder", builder);
  }
  if (values.get("review")) setField("review", true);
  const reviewer = stringValue(values, "reviewer");
  if (reviewer === "claude" || reviewer === "codex")
    setField("reviewer", reviewer);
  const fixRounds = stringValue(values, "max-fix-rounds");
  if (fixRounds && /^\d+$/.test(fixRounds))
    setField("maxFixRounds", Number(fixRounds));
  if (values.get("allow-stale-sdk")) setField("allowStaleSdk", true);
  const yes = Boolean(values.get("yes") || values.get("y"));
  if (yes) setField("autoApprove", true);

  const intentAgent = stringValue(values, "intent-agent");
  const consolePortRaw = stringValue(values, "console-port");
  return {
    help: Boolean(values.get("help") || values.get("h")),
    yes,
    dryRun: Boolean(values.get("dry-run")),
    overwrite: Boolean(values.get("overwrite")),
    runsRoot: stringValue(values, "state-root") ?? defaultRunsRoot,
    intentAgent: intentAgent === "codex" ? "codex" : "claude",
    console: values.get("no-console")
      ? false
      : values.get("console")
        ? true
        : undefined,
    consolePort:
      consolePortRaw && /^\d+$/.test(consolePortRaw)
        ? Number(consolePortRaw)
        : undefined,
    consoleBuiltin: Boolean(values.get("console-builtin")),
    draft,
    provided,
  };
}

function printHelp() {
  console.log(`Aomi Smither — compose a Smithers workflow from your intent and build an Aomi package

USAGE
  aomi-smither                              Interactive: chat about what to build
  aomi-smither --package <name> --yes           Headless: run straight from flags

OPTIONS
  --package <name>                Package name
  --sdk-root <path>           Aomi SDK checkout (default: ../aomi-sdk)
  --state-root <path>         Run state root (default: packages/smither/.smithers/runs)
  --openapi-url <url>         Generate from a known OpenAPI URL
  --existing                  Use existing packages/<name>/openapi.yaml
  --shared                    Generate shared provider under ext/
  --force                     Overwrite generated package files
  --no-build                  Skip aomi-build's cargo build step
  --user-story <text>         Primary workflow the package should support
  --builder claude|codex|none Agent that curates tools and repairs validation
  --review                    Second agent reviews the curation (forked session)
  --reviewer claude|codex     Reviewing agent (default: codex)
  --max-fix-rounds <n>        Validation repair budget (default: 2)
  --intent-agent claude|codex Agent that distills the intake chat (default: claude)
  --allow-stale-sdk           Skip the GitHub-freshness guarantee for the SDK checkout
  --dry-run                   Show the composed plan and stages without running
  --overwrite                 Reset existing .smithers run state for the package
  --resume                    (implicit) an existing run for the package resumes automatically
  --yes                       Auto-approve gates; required for headless runs
  --console / --no-console    Browser console sidecar (Smithers Gateway on
                              127.0.0.1): aomi-branded live stage rail, node
                              outputs, and approve/deny. Default: on for
                              interactive runs, off for headless.
  --console-port <n>          First port to try for the console (default: 7331)
  --console-builtin           Use the generic Smithers operator console instead
                              of the aomi-branded UI

SUBCOMMANDS
  run-plan                    Execute a caller-composed plan JSON headlessly
                              (for control planes / remote runners)
    --plan <path>             Plan JSON file (finalizePlan-validated)
    --plan-b64 <b64>          Plan JSON inline as base64 (instead of --plan)
    --run-id <id>             Pre-allocated run id for fresh state
    --state-root <path>       Run state root (default: packages/smither/.smithers/runs)

  console                     Observe a package's run from a browser (works while
                              a run executes in another terminal)
    --package <name>              Package whose run state to watch (required)
    --state-root <path>       Run state root (default: packages/smither/.smithers/runs)
    --port <n>                Console port (default: 7331)
    --console-builtin         Use the generic operator console instead of aomi UI

Requires Bun (https://bun.sh) — Smithers persists runs in bun:sqlite.
`);
}

// ---------------------------------------------------------------------------
// Run view model: stages + events
// ---------------------------------------------------------------------------

type StageStatus = "pending" | "running" | "complete" | "failed" | "waiting";

type RunViewState = {
  stageStatus: Record<string, StageStatus>;
  lines: string[];
  approvals: { nodeId: string; iteration: number; title?: string }[];
};

function reduceEvent(
  plan: BuildPlan,
  state: RunViewState,
  event: SmithersEvent,
): RunViewState {
  const next: RunViewState = {
    stageStatus: { ...state.stageStatus },
    lines: [...state.lines],
    approvals: [...state.approvals],
  };
  const push = (line: string) => {
    next.lines = [...next.lines.slice(-120), line];
  };
  const setStage = (nodeIdValue: string, status: StageStatus) => {
    const key = stageKeyForNode(plan, nodeIdValue);
    // Never let a later loop iteration mark a finished stage as pending again.
    if (next.stageStatus[key] === "complete" && status === "running") return;
    next.stageStatus[key] = status;
  };

  switch (event.type) {
    case "NodeStarted":
      setStage(event.nodeId, "running");
      push(
        `▸ ${event.nodeId}${event.iteration > 0 ? ` (round ${event.iteration + 1})` : ""}`,
      );
      break;
    case "NodeFinished":
      setStage(event.nodeId, "complete");
      push(`✓ ${event.nodeId}`);
      break;
    case "NodeFailed": {
      setStage(event.nodeId, "failed");
      const message =
        event.error instanceof Error
          ? event.error.message
          : typeof event.error === "string"
            ? event.error
            : JSON.stringify(event.error);
      push(`✗ ${event.nodeId}: ${message?.slice(0, 400) ?? "failed"}`);
      break;
    }
    case "NodeRetrying":
      push(`↻ ${event.nodeId} retrying (attempt ${event.attempt})`);
      break;
    case "NodeWaitingApproval": {
      setStage(event.nodeId, "waiting");
      const exists = next.approvals.some(
        (approval) =>
          approval.nodeId === event.nodeId &&
          approval.iteration === event.iteration,
      );
      if (!exists) {
        next.approvals.push({
          nodeId: event.nodeId,
          iteration: event.iteration,
        });
        push(`⏸ ${event.nodeId} awaiting approval`);
      }
      break;
    }
    case "ApprovalRequested": {
      const request = (event as { request?: { title?: string } }).request;
      const pending = next.approvals.find(
        (approval) => approval.nodeId === (event as { nodeId?: string }).nodeId,
      );
      if (pending && request?.title) {
        pending.title = request.title;
      }
      break;
    }
    case "ApprovalGranted":
    case "ApprovalDenied": {
      const nodeIdValue = (event as { nodeId?: string }).nodeId;
      next.approvals = next.approvals.filter(
        (approval) => approval.nodeId !== nodeIdValue,
      );
      break;
    }
    case "RunStatusChanged":
      push(`run status: ${event.status}`);
      break;
    default:
      break;
  }
  return next;
}

function stageSymbol(status: StageStatus | undefined): string {
  switch (status) {
    case "running":
      return "◐";
    case "complete":
      return "✓";
    case "failed":
      return "✗";
    case "waiting":
      return "⏸";
    default:
      return "·";
  }
}

// ---------------------------------------------------------------------------
// Interactive package
// ---------------------------------------------------------------------------

const GREETING =
  "What Aomi package do you wanna build? Tell me about the product or API — I'll compose the workflow (spec source, agents, validation) from your answers.";

type Screen =
  | { name: "chat"; thinking: boolean; error?: string }
  | { name: "preview"; plan: BuildPlan }
  | { name: "running"; plan: BuildPlan }
  | { name: "fatal"; message: string };

function SmitherApp({ args }: { args: CliArgs }) {
  const { exit } = useApp();
  const [turns, setTurns] = useState<IntentTurn[]>([
    { role: "smither", text: GREETING },
  ]);
  const [draft, setDraft] = useState<Partial<BuildPlan>>(args.draft);
  const [screen, setScreen] = useState<Screen>({
    name: "chat",
    thinking: false,
  });
  const intakeRef = useRef<IntakeServerHandle | null>(null);
  const [intakeUrl, setIntakeUrl] = useState<string | null>(null);

  // Boot the intake view at t=0 so the browser shows the composer working —
  // the conversation, the plan forming, the composed stages — before any
  // Smithers workflow exists. Off when the console is disabled or headless.
  useEffect(() => {
    if (args.console === false) return;
    let handle: IntakeServerHandle | null = null;
    void (async () => {
      try {
        handle = await startIntakeServer({
          packageName:
            typeof args.draft.packageName === "string"
              ? args.draft.packageName
              : "new package",
          port: args.consolePort,
        });
        intakeRef.current = handle;
        setIntakeUrl(handle.url);
      } catch {
        /* intake view is best-effort; the terminal chat proceeds regardless */
      }
    })();
    return () => {
      handle?.close();
    };
  }, []);

  // Mirror chat state into the intake view every time it changes.
  useEffect(() => {
    const outcome = finalizePlan(draft);
    intakeRef.current?.update({
      packageName:
        typeof draft.packageName === "string"
          ? draft.packageName
          : "new package",
      turns,
      draft,
      thinking: screen.name === "chat" && screen.thinking,
      thinkingSince:
        screen.name === "chat" && screen.thinking ? Date.now() : null,
      stages: outcome.plan ? stagesFor(outcome.plan) : [],
      phase:
        screen.name === "running"
          ? "building"
          : screen.name === "preview"
            ? "preview"
            : "intake",
    });
  }, [turns, draft, screen]);

  const submitChat = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (trimmed === "/quit") {
        exit();
        return;
      }
      if (trimmed === "/go" || trimmed === "/plan") {
        const outcome = finalizePlan(draft);
        if (outcome.plan) {
          setScreen({ name: "preview", plan: outcome.plan });
        } else {
          setTurns((prev) => [
            ...prev,
            {
              role: "smither",
              text: `Not runnable yet: ${outcome.issues.join("; ")}`,
            },
          ]);
        }
        return;
      }
      const nextTurns: IntentTurn[] = [
        ...turns,
        { role: "user", text: trimmed },
      ];
      setTurns(nextTurns);
      setScreen({ name: "chat", thinking: true });
      void (async () => {
        try {
          const result = await distillIntent({
            turns: nextTurns,
            draft,
            sdkRoot: draft.sdkRoot ?? defaultSdkRoot(),
            agent: args.intentAgent,
          });
          const merged = mergePlanDraft(draft, result.plan);
          setDraft(merged);
          const reply = [
            result.summary,
            ...result.questions.map((question) => `· ${question}`),
          ]
            .filter(Boolean)
            .join("\n");
          setTurns((prev) => [
            ...prev,
            { role: "smither", text: reply || "Noted." },
          ]);
          const outcome = finalizePlan(merged);
          if (result.ready && outcome.plan) {
            setScreen({ name: "preview", plan: outcome.plan });
          } else {
            setScreen({ name: "chat", thinking: false });
          }
        } catch (error) {
          setScreen({
            name: "chat",
            thinking: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    },
    [args.intentAgent, draft, exit, turns],
  );

  if (screen.name === "fatal") {
    return <Text color="red">Failed: {screen.message}</Text>;
  }

  if (screen.name === "chat") {
    return (
      <Box flexDirection="column" gap={0}>
        <Text bold>Aomi Smither</Text>
        {intakeUrl ? <Text dimColor>⌗ intake view: {intakeUrl}</Text> : null}
        {turns.slice(-12).map((turn, index) => (
          <Text
            key={index}
            color={turn.role === "smither" ? "cyan" : undefined}
          >
            {turn.role === "smither" ? "smither" : "you"}: {turn.text}
          </Text>
        ))}
        {screen.error ? <Text color="red">{screen.error}</Text> : null}
        {screen.thinking ? (
          <ThinkingLine />
        ) : (
          <Box>
            <Text>{"> "}</Text>
            <TextInput
              placeholder="describe the package (/go to run, /quit to exit)"
              onSubmit={submitChat}
            />
          </Box>
        )}
      </Box>
    );
  }

  if (screen.name === "preview") {
    return (
      <Box flexDirection="column" gap={0}>
        <Text bold>Plan</Text>
        {describePlan(screen.plan).map((line) => (
          <Text key={line}> {line}</Text>
        ))}
        <Text bold>Workflow</Text>
        {stagesFor(screen.plan).map((stage) => (
          <Text key={stage.id}> · {stage.label}</Text>
        ))}
        <Text>Start this run? (state persists; re-running resumes)</Text>
        <ConfirmInput
          onConfirm={() => setScreen({ name: "running", plan: screen.plan })}
          onCancel={() => {
            setTurns((prev) => [
              ...prev,
              { role: "smither", text: "Okay — what should change?" },
            ]);
            setScreen({ name: "chat", thinking: false });
          }}
        />
      </Box>
    );
  }

  return (
    <RunView
      plan={screen.plan}
      args={args}
      onConsoleUrl={(url) => {
        // Hand the gateway console URL to the intake page so the browser tab
        // that watched the composition follows into the live build graph.
        intakeRef.current?.update({ phase: "building", buildUrl: url });
      }}
      onExit={(code) => {
        process.exitCode = code;
        intakeRef.current?.close();
        exit();
        // The Smithers engine keeps heartbeat/timer handles alive after the
        // run resolves; give Ink one tick to flush, then exit for real.
        setTimeout(() => process.exit(code), 100);
      }}
    />
  );
}

function ThinkingLine() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((prev) => prev + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Text dimColor>thinking… ({seconds}s — one claude call per turn)</Text>
  );
}

function RunView({
  plan,
  args,
  onExit,
  onConsoleUrl,
}: {
  plan: BuildPlan;
  args: CliArgs;
  onExit: (code: number) => void;
  onConsoleUrl?: (url: string) => void;
}) {
  const stages = stagesFor(plan);
  const [view, setView] = useState<RunViewState>({
    stageStatus: {},
    lines: [],
    approvals: [],
  });
  const [tail, setTail] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [consoleUrl, setConsoleUrl] = useState<string | null>(null);
  const preparedRef = useRef<PreparedRun | null>(null);
  const consoleRef = useRef<ConsoleHandle | null>(null);

  useEffect(() => {
    // Stream compute-step command output (cargo, aomi-build, git) into the
    // view. Agent steps run through Smithers' own agent transport, not this
    // runner, so they surface via node events only.
    const streamingRunner: CommandRunner = (file, cmdArgs, options) =>
      defaultRunner(file, cmdArgs, {
        ...options,
        onOutput: (chunk) => {
          options?.onOutput?.(chunk);
          const fresh = chunk.data
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          if (fresh.length > 0) {
            setTail((prev) => [...prev, ...fresh].slice(-4));
          }
        },
      });
    void (async () => {
      try {
        const prepared = await prepareRun({
          plan,
          deps: {
            env: process.env,
            runner: streamingRunner,
          },
          runsRoot: args.runsRoot,
          overwrite: args.overwrite,
        });
        preparedRef.current = prepared;
        if (args.console ?? true) {
          // Gateway sidecar on the run's own SQLite: browser console with the
          // live task graph, node outputs, and approve/deny. Never fatal —
          // the TUI run proceeds without it.
          try {
            const handle = await startConsole({
              workflow: prepared.workflow,
              packageName: plan.packageName,
              api: prepared.api,
              plan,
              builtinConsole: args.consoleBuiltin,
              port: args.consolePort,
            });
            consoleRef.current = handle;
            setConsoleUrl(handle.workflowUrl);
            onConsoleUrl?.(handle.workflowUrl);
          } catch (error) {
            setView((prev) => ({
              ...prev,
              lines: [
                ...prev.lines,
                `console unavailable: ${error instanceof Error ? error.message : String(error)}`,
              ],
            }));
          }
        }
        const result = await executeRunUntilSettled(prepared, {
          onEvent: (event) => setView((prev) => reduceEvent(plan, prev, event)),
        });
        setOutcome(result.status);
        onExit(result.status === "finished" ? 0 : 1);
      } catch (error) {
        setOutcome(error instanceof Error ? error.message : String(error));
        onExit(1);
      }
    })();
  }, []);

  const decide = useCallback(
    (
      approval: { nodeId: string; iteration: number },
      approve: boolean,
      selection?: { selected: string; notes?: string },
    ) => {
      const prepared = preparedRef.current;
      if (!prepared) return;
      void decideApproval({
        api: prepared.api,
        runId: prepared.runId,
        nodeId: approval.nodeId,
        iteration: approval.iteration,
        approve,
        selection,
      }).catch((error) => {
        setView((prev) => ({
          ...prev,
          lines: [...prev.lines, `approval write failed: ${String(error)}`],
        }));
      });
      // Optimistically clear; ApprovalGranted/Denied confirms.
      setView((prev) => ({
        ...prev,
        approvals: prev.approvals.filter(
          (pending) =>
            !(
              pending.nodeId === approval.nodeId &&
              pending.iteration === approval.iteration
            ),
        ),
      }));
    },
    [],
  );

  const pendingApproval = view.approvals[0];
  return (
    <Box flexDirection="column" gap={0}>
      <Text bold>
        Building {plan.packageName} {outcome ? `— ${outcome}` : ""}
      </Text>
      {consoleUrl ? <Text dimColor>⌗ live console: {consoleUrl}</Text> : null}
      {stages.map((stage: PlanStage) => (
        <Text key={stage.id}>
          {stageSymbol(view.stageStatus[stage.id])} {stage.label}
        </Text>
      ))}
      {view.lines.slice(-8).map((line, index) => (
        <Text key={`${index}-${line.slice(0, 24)}`} dimColor>
          {line}
        </Text>
      ))}
      {!outcome && tail.length > 0 ? (
        <Box flexDirection="column" marginLeft={2}>
          {tail.map((line, index) => (
            <Text key={`tail-${index}`} dimColor>
              {line.slice(0, 100)}
            </Text>
          ))}
        </Box>
      ) : null}
      {pendingApproval && !outcome
        ? (() => {
            const stage = stages.find((s) => s.id === pendingApproval.nodeId);
            if (stage?.kind === "clarify" && stage.clarify) {
              return (
                <Box flexDirection="column">
                  <Text color="yellow">{stage.clarify.question}</Text>
                  {stage.clarify.summary ? (
                    <Text dimColor>{stage.clarify.summary}</Text>
                  ) : null}
                  <Select
                    options={stage.clarify.options.map((option) => ({
                      label: option.summary
                        ? `${option.label} — ${option.summary}`
                        : option.label,
                      value: option.key,
                    }))}
                    onChange={(value) =>
                      decide(pendingApproval, true, { selected: value })
                    }
                  />
                </Box>
              );
            }
            return (
              <Box flexDirection="column">
                <Text color="yellow">
                  {pendingApproval.title ??
                    `Approve ${pendingApproval.nodeId}?`}
                </Text>
                <ConfirmInput
                  onConfirm={() => decide(pendingApproval, true)}
                  onCancel={() => decide(pendingApproval, false)}
                />
              </Box>
            );
          })()
        : null}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Headless mode
// ---------------------------------------------------------------------------

async function runHeadless(args: CliArgs): Promise<void> {
  const outcome = finalizePlan(args.draft);
  if (!outcome.plan) {
    console.error(`plan incomplete: ${outcome.issues.join("; ")}`);
    console.error("headless runs need at least --package (see --help)");
    process.exitCode = 1;
    return;
  }
  const plan = outcome.plan;
  if (!args.yes && plan.builder !== "none") {
    console.error(
      "non-interactive runs cannot prompt at approval gates; pass --yes to auto-approve",
    );
    process.exitCode = 1;
    return;
  }
  if (args.dryRun) {
    printDryRun(plan);
    return;
  }
  try {
    const prepared = await prepareRun({
      plan,
      runsRoot: args.runsRoot,
      overwrite: args.overwrite,
    });
    console.log(
      `${prepared.resume ? "resuming" : "starting"} run ${prepared.runId} (state: ${prepared.stateLocation})`,
    );
    if (args.console === true) {
      try {
        const handle = await startConsole({
          workflow: prepared.workflow,
          packageName: plan.packageName,
          api: prepared.api,
          plan,
          builtinConsole: args.consoleBuiltin,
          port: args.consolePort,
        });
        console.error(`live console: ${handle.workflowUrl}`);
      } catch (error) {
        console.error(
          `console unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const result = await executeRunUntilSettled(prepared, {
      onEvent: (event) => {
        if (event.type === "NodeStarted") console.error(`▸ ${event.nodeId}`);
        if (event.type === "NodeFinished") console.error(`✓ ${event.nodeId}`);
        if (event.type === "NodeFailed") {
          const message =
            event.error instanceof Error
              ? event.error.message
              : String(event.error);
          console.error(`✗ ${event.nodeId}: ${message}`);
        }
      },
    });
    console.log(`run ${result.status}`);
    // The engine keeps timer handles alive after the run resolves; exit
    // explicitly so headless invocations terminate.
    process.exit(
      result.status === "finished"
        ? 0
        : result.status === "waiting-approval"
          ? 2
          : 1,
    );
  } catch (error) {
    console.error(
      `Failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

function printDryRun(plan: BuildPlan): void {
  console.log("Plan:");
  for (const line of describePlan(plan)) {
    console.log(`  ${line}`);
  }
  console.log("Workflow:");
  for (const stage of stagesFor(plan)) {
    console.log(`  · ${stage.label} [${stage.kind}] (${stage.id})`);
  }
  console.log("(dry-run: nothing executed)");
}

// ---------------------------------------------------------------------------
// Rollback (unchanged flow: deterministic, no Smithers involvement)
// ---------------------------------------------------------------------------

async function runConsoleCommand(argv: string[]): Promise<void> {
  const values = parseFlagMap(argv);
  const packageName = stringValue(values, "package") ?? "";
  if (values.get("help") || values.get("h") || !packageName) {
    if (!packageName) console.error("console requires --package <name>");
    printHelp();
    process.exitCode = packageName ? 0 : 1;
    return;
  }
  const portRaw =
    stringValue(values, "port") ?? stringValue(values, "console-port");
  try {
    const handle = await startConsoleForApp({
      packageName,
      runsRoot: stringValue(values, "state-root") ?? defaultRunsRoot,
      port: portRaw && /^\d+$/.test(portRaw) ? Number(portRaw) : undefined,
      builtinConsole: Boolean(values.get("console-builtin")),
    });
    console.log(`aomi console: ${handle.workflowUrl}`);
    console.log(`operator:     ${handle.consoleUrl}`);
    console.log(
      "Streaming run state from this package's smithers.sqlite (live if a run is executing elsewhere). Ctrl-C to stop.",
    );
    // The gateway's HTTP server keeps the event loop alive until Ctrl-C.
  } catch (error) {
    console.error(
      `Failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

/** `aomi-smither signal --packageName <packageName> --node <phaseId>` — deliver the external
 *  signal that resolves a wait-external pause. Run from another terminal (or an
 *  external system) once the outside work the run is parked on is done. */
/**
 * Headless runner for a control plane: execute a caller-composed plan JSON
 * without any interactive surface. Used by remote runners (sandboxes) whose
 * plan was composed elsewhere (the web BFF) and whose run id was
 * pre-allocated so the caller can watch the durable store from outside.
 */
async function runPlanCommand(argv: string[]): Promise<void> {
  const values = parseFlagMap(argv);
  const planArg = stringValue(values, "plan");
  const planB64 = stringValue(values, "plan-b64");
  if (values.get("help") || values.get("h") || (!planArg && !planB64)) {
    if (!planArg && !planB64) {
      console.error(
        "run-plan requires --plan <path> or --plan-b64 <base64 JSON>",
      );
    }
    printHelp();
    process.exitCode = planArg || planB64 ? 0 : 1;
    return;
  }
  try {
    const raw = planB64
      ? Buffer.from(planB64, "base64").toString("utf8")
      : await (
          await import("node:fs/promises")
        ).readFile(planArg as string, "utf8");
    const { plan, issues } = finalizePlan(
      JSON.parse(raw) as Partial<BuildPlan>,
    );
    if (!plan) {
      console.error(`invalid plan: ${issues.join("; ")}`);
      process.exitCode = 1;
      return;
    }
    const { prepareRun, executeRunUntilSettled, readRunView } =
      await import("./run");
    let prepared = await prepareRun({
      plan,
      runsRoot: stringValue(values, "state-root") ?? defaultRunsRoot,
      runId: stringValue(values, "run-id"),
    });
    // A fresh runner (new sandbox, no local run.json) continuing a run the
    // shared store already knows must execute with resume, or the engine
    // treats the pre-existing run id as a conflict instead of a replay.
    if (!prepared.resume) {
      const view = await readRunView(prepared.api, prepared.runId);
      if (view.status !== null) prepared = { ...prepared, resume: true };
    }
    console.error(
      `${prepared.resume ? "resuming" : "starting"} run ${prepared.runId} (state: ${prepared.stateLocation})`,
    );
    const result = await executeRunUntilSettled(prepared, {
      onEvent: (event) => {
        if (event.type === "NodeStarted") console.error(`▸ ${event.nodeId}`);
        if (event.type === "NodeFinished") console.error(`✓ ${event.nodeId}`);
        if (event.type === "NodeFailed") {
          const message =
            event.error instanceof Error
              ? event.error.message
              : String(event.error);
          console.error(`✗ ${event.nodeId}: ${message.slice(0, 400)}`);
        }
      },
    });
    console.error(`run settled: ${result.status}`);
    process.exitCode =
      result.status === "finished" || result.status === "continued" ? 0 : 1;
  } catch (error) {
    console.error(
      `Failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

async function runSignalCommand(argv: string[]): Promise<void> {
  const values = parseFlagMap(argv);
  const packageName = stringValue(values, "package") ?? "";
  const node =
    stringValue(values, "node") ?? stringValue(values, "phase") ?? "";
  if (values.get("help") || values.get("h") || !packageName || !node) {
    if (!packageName || !node)
      console.error("signal requires --package <name> and --node <phaseId>");
    printHelp();
    process.exitCode = packageName && node ? 0 : 1;
    return;
  }
  try {
    const { loadPlan } = await import("./state");
    const { createAomiSmither } = await import("./workflow");
    const { loadRunState, smitherDbPath } = await import("./state");
    const runsRoot = stringValue(values, "state-root") ?? defaultRunsRoot;
    const plan = await loadPlan(packageName, runsRoot);
    const state = await loadRunState(packageName, runsRoot);
    if (!plan || !state) {
      console.error(
        `No run found for package "${packageName}" under ${runsRoot}. Start a run first.`,
      );
      process.exitCode = 1;
      return;
    }
    // The wait-external node id is namespaced by package, same as every stage.
    const nodeId = node.includes(":") ? node : `${packageName}:${node}`;
    const api = await createAomiSmither(smitherDbPath(packageName, runsRoot));
    const { sendSignal } = await import("./run");
    await sendSignal({
      api,
      runId: state.runId,
      nodeId,
      ready: !values.get("not-ready"),
      note: stringValue(values, "note") ?? "",
      receivedBy: stringValue(values, "by") ?? "cli",
    });
    console.log(
      `signalled ${nodeId} (run ${state.runId}). Re-run the package to resume, or it resumes if a run is live.`,
    );
  } catch (error) {
    console.error(
      `Failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

const [subcommand, ...restArgv] = process.argv.slice(2);
if (subcommand === "console") {
  await runConsoleCommand(restArgv);
} else if (subcommand === "signal") {
  await runSignalCommand(restArgv);
} else if (subcommand === "run-plan") {
  await runPlanCommand(restArgv);
} else {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
  } else if (args.dryRun && args.provided.has("packageName")) {
    const outcome = finalizePlan(args.draft);
    if (outcome.plan) {
      printDryRun(outcome.plan);
    } else {
      console.error(`plan incomplete: ${outcome.issues.join("; ")}`);
      process.exitCode = 1;
    }
  } else if (args.yes || !process.stdin.isTTY) {
    await runHeadless(args);
  } else {
    render(<SmitherApp args={args} />);
  }
}
