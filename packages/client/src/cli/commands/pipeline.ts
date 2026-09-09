import { readFile } from "node:fs/promises";
import type {
  EvmDirectInput,
  EvmSimulatedBuild,
  EvmStageInput,
  EvmStagedBuild,
  PipelineDirectory,
  PipelineOperationBuildInput,
  SvmDirectInput,
  SvmSimulatedBuild,
  SvmStageInput,
  SvmStagedBuild,
} from "../../pipeline/types";
import {
  AomiPipeline,
  type AomiPipelineOperationScope,
} from "../../sdk/pipeline";
import { CliSession } from "../cli-session";
import { createControlClient } from "../context";
import { printJson, printPaymentEvent } from "../output";
import type { CliConfig } from "../types";

type Chain = "evm" | "svm";
type Lifecycle = "build" | "stage" | "simulate" | "commit";

interface ScopeOptions {
  app?: string;
  skill?: string;
}

export async function pipelineReadCommand(
  config: CliConfig,
  path?: string,
): Promise<void> {
  printJson(await createControlClient(config).pipeline.read(path));
}

export async function pipelineAppsCommand(
  config: CliConfig,
  options: { filter?: string; limit?: number },
): Promise<void> {
  const directory = await createControlClient(config).pipeline.apps.list();
  printJson(filterEntries(directory, options));
}

export async function pipelineAppCommand(
  config: CliConfig,
  app: string,
): Promise<void> {
  printJson(await createControlClient(config).pipeline.app(app).directory());
}

export async function pipelineSkillsCommand(
  config: CliConfig,
  options: { filter?: string; limit?: number },
): Promise<void> {
  const directory = await createControlClient(config).pipeline.skills.list();
  printJson(filterEntries(directory, options));
}

export async function pipelineSkillCommand(
  config: CliConfig,
  skill: string,
  instructions = false,
): Promise<void> {
  const selected = createControlClient(config).pipeline.skill(skill);
  if (instructions) {
    process.stdout.write(await selected.instructions());
    return;
  }
  printJson(await selected.directory());
}

export async function pipelineOperationsCommand(
  config: CliConfig,
  options: ScopeOptions & { filter?: string; limit?: number },
): Promise<void> {
  const directory = await pipelineScope(config, options).operations();
  printJson(filterEntries(directory, options));
}

export async function pipelineOperationCommand(
  config: CliConfig,
  operation: string,
  options: ScopeOptions,
): Promise<void> {
  printJson(await pipelineScope(config, options).operation(operation));
}

export async function pipelineInvokeCommand(
  config: CliConfig,
  operation: string,
  options: ScopeOptions & { arguments?: string; idempotencyKey?: string },
): Promise<void> {
  const scope = pipelineScope(config, options, true);
  printJson(
    await scope.invoke(
      operation,
      await readPipelineObject(options.arguments, "--arguments", {}),
      { idempotencyKey: options.idempotencyKey },
    ),
  );
}

export async function pipelineBuildCommand(
  config: CliConfig,
  operation: string,
  options: ScopeOptions & {
    arguments?: string;
    chainFamily?: Chain;
  },
): Promise<void> {
  const scope = pipelineScope(config, options, true);
  const build = await scope.build(
    operation,
    await readPipelineObject(options.arguments, "--arguments", {}),
    { chainFamily: options.chainFamily },
  );
  printJson(build);
}

export async function pipelineLifecycleCommand(
  config: CliConfig,
  chain: Chain,
  lifecycle: Lifecycle,
  input: string,
  idempotencyKey?: string,
): Promise<void> {
  const value = await readPipelineObject(input, "input");
  const pipeline = createPipeline(config, true);

  if (chain === "evm") {
    const evm = pipeline.evm;
    switch (lifecycle) {
      case "build":
        printJson(
          await evm.build(
            value as PipelineOperationBuildInput | EvmDirectInput,
          ),
        );
        return;
      case "stage":
        printJson(
          await evm.stage(value as unknown as EvmStageInput | EvmDirectInput),
        );
        return;
      case "simulate":
        requireBuildStatus(value, "staged");
        printJson(await evm.simulate(value as unknown as EvmStagedBuild));
        return;
      case "commit":
        requireBuildStatus(value, "simulated");
        printJson(
          await evm.commit(value as unknown as EvmSimulatedBuild, {
            idempotencyKey,
          }),
        );
        return;
    }
  }

  const svm = pipeline.svm;
  switch (lifecycle) {
    case "build":
      printJson(
        await svm.build(value as PipelineOperationBuildInput | SvmDirectInput),
      );
      return;
    case "stage":
      printJson(await svm.stage(value as unknown as SvmStageInput));
      return;
    case "simulate":
      requireBuildStatus(value, "staged");
      printJson(await svm.simulate(value as unknown as SvmStagedBuild));
      return;
    case "commit":
      requireBuildStatus(value, "simulated");
      printJson(
        await svm.commit(value as unknown as SvmSimulatedBuild, {
          idempotencyKey,
        }),
      );
  }
}

async function readPipelineObject(
  input: string | undefined,
  label: string,
  fallback?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!input?.trim()) {
    if (fallback) return fallback;
    throw new TypeError(`${label} is required`);
  }
  const source = input.trim();
  const json =
    source.startsWith("{") || source.startsWith("[")
      ? source
      : source === "-"
        ? await readStdin()
        : await readFile(
            source.startsWith("@") ? source.slice(1) : source,
            "utf8",
          );
  return pipelineObject(JSON.parse(json) as unknown, label);
}

function pipelineObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function pipelineScope(
  config: CliConfig,
  options: ScopeOptions,
  payment = false,
): AomiPipelineOperationScope {
  if (options.app && options.skill) {
    throw new TypeError("Choose only one of --app or --skill");
  }
  const pipeline = createPipeline(config, payment);
  if (options.skill) return pipeline.skill(options.skill);
  const app =
    options.app?.trim() || CliSession.load()?.app || config.app || "default";
  return pipeline.app(app);
}

function createPipeline(config: CliConfig, payment = false): AomiPipeline {
  const client = payment
    ? createControlClient(config, {
        payment: true,
        onPayment: printPaymentEvent,
      })
    : createControlClient(config);
  return new AomiPipeline(client.pipeline);
}

function filterEntries(
  directory: PipelineDirectory,
  options: { filter?: string; limit?: number },
): PipelineDirectory {
  const filter = options.filter?.trim().toLowerCase();
  const entries = directory.entries.filter(
    (entry) => !filter || entry.name.toLowerCase().includes(filter),
  );
  return {
    ...directory,
    entries:
      options.limit === undefined ? entries : entries.slice(0, options.limit),
  };
}

function requireBuildStatus(
  value: Record<string, unknown>,
  expected: "staged" | "simulated",
): void {
  if (value.status !== expected) {
    throw new TypeError(`input must be a ${expected} Pipeline Build`);
  }
}
