import type { AomiClient } from "../client";
import { CommitController, type CommitCapabilities } from "../commits";
import type {
  EvmPipelineTransport,
  PipelineOperationTransport,
  PipelineSkillTransport,
  PipelineTransport,
  SvmPipelineTransport,
} from "../pipeline/transport";
import { validatePipelineArguments } from "../pipeline/schema";
import type {
  EvmCommitResult,
  EvmDirectInput,
  EvmSimulatedBuild,
  EvmStageInput,
  EvmStagedBuild,
  PipelineCommitOptions,
  PipelineInvokeOptions,
  PipelineMutationOptions,
  PipelineOperationBuildInput,
  PipelineOperationDescriptor,
  SvmCommitResult,
  SvmDirectInput,
  SvmSimulatedBuild,
  SvmStageInput,
  SvmStagedBuild,
} from "../pipeline/types";
import { EvmBuild, EvmStaged, SvmBuild, SvmStaged } from "./build";

export class AomiEvmPipeline {
  constructor(
    readonly raw: EvmPipelineTransport,
    private readonly client?: AomiClient,
    private readonly capabilities: CommitCapabilities = {},
  ) {}

  /** Continue the exact prepared cohort through the durable Commit lifecycle. */
  commits(
    preparation: EvmCommitResult,
    capabilities = this.capabilities,
  ): CommitController {
    if (
      !this.client ||
      !preparation.thread_id ||
      !preparation.actions?.length ||
      !preparation.commits?.length
    )
      throw new Error("Durable Pipeline continuation is unavailable");
    const refs = preparation.requests.flatMap((request) => {
      if (request.type !== "execute_evm" || !request.commitStages?.length)
        throw new Error("Pipeline request has no durable commit stages");
      if (request.commitStages.length !== request.transactions.length)
        throw new Error("Pipeline cohort cardinality mismatch");
      return request.commitStages;
    });
    if (
      preparation.actions.length !== preparation.requests.length ||
      new Set(preparation.actions.map((action) => action.id)).size !==
        preparation.actions.length ||
      preparation.actions.some(
        (action, index) =>
          !action.id ||
          JSON.stringify(action.request) !==
            JSON.stringify(preparation.requests[index]),
      )
    )
      throw new Error("Pipeline Action identity mismatch");
    const savedViews = preparation.commits;
    const views = refs.map((stage) => {
      const matches = savedViews.filter((view) => view.stage_id === stage);
      if (matches.length !== 1)
        throw new Error("Pipeline cohort identity mismatch");
      return matches[0]!;
    });
    if (
      new Set(refs).size !== refs.length ||
      refs.length !== preparation.commits.length ||
      new Set(views.map((view) => view.commit_id)).size !== views.length ||
      views.some(
        (view, index) =>
          view.chain_family !== "evm" ||
          view.thread_id !== preparation.thread_id ||
          view.stage_id !== refs[index] ||
          (views.length > 1 &&
            (!view.batch ||
              view.batch.index !== index ||
              view.batch.batch_id !== views[0]?.batch?.batch_id ||
              view.batch.ordered_stage_ids.length !== refs.length ||
              view.batch.ordered_stage_ids.some(
                (stage, position) => stage !== refs[position],
              ) ||
              view.batch.ordered_commit_ids.length !== views.length ||
              view.batch.ordered_commit_ids.some(
                (id, position) => id !== views[position]?.commit_id,
              ))),
      )
    )
      throw new Error("Pipeline cohort identity mismatch");
    const controller = new CommitController(
      this.client,
      preparation.thread_id,
      capabilities,
      "pipeline",
    );
    for (const view of views) controller.ingest(view);
    return controller;
  }

  async build(
    input: PipelineOperationBuildInput | EvmDirectInput,
    options?: PipelineMutationOptions,
  ): Promise<EvmBuild> {
    if ("calls" in input) {
      return (await this.stage(input, options)).simulate(options);
    }
    const build = options
      ? await this.raw.build(input, options)
      : await this.raw.build(input);
    return new EvmBuild(build, this.raw);
  }

  async stage(
    input: EvmStageInput | EvmDirectInput,
    options?: PipelineMutationOptions,
  ): Promise<EvmStaged> {
    const request: EvmStageInput =
      "actions" in input
        ? input
        : {
            app: input.app,
            skills: input.skills,
            transactionSafetyMode: input.transactionSafetyMode,
            actions: input.calls.map((call) => ({
              to: call.to,
              chain_id: input.chainId,
              description:
                call.description ?? input.description ?? "Transaction",
              data: { signature: "", args: [], raw: call.data ?? "0x" },
              value: call.value,
              gas_limit: call.gas,
            })),
          };
    const build = options
      ? await this.raw.stage(request, options)
      : await this.raw.stage(request);
    return new EvmStaged(build, this.raw);
  }

  async simulate(
    build: EvmStaged | EvmStagedBuild,
    options?: PipelineMutationOptions,
  ): Promise<EvmBuild> {
    const value = build instanceof EvmStaged ? build.raw : build;
    const simulated = options
      ? await this.raw.simulate(value, options)
      : await this.raw.simulate(value);
    return new EvmBuild(simulated, this.raw);
  }

  commit(
    build: EvmBuild | EvmSimulatedBuild,
    options?: PipelineCommitOptions,
  ): Promise<EvmCommitResult> {
    const value =
      build instanceof EvmBuild ? build : new EvmBuild(build, this.raw);
    return value.commit(options);
  }
}

export class AomiSvmPipeline {
  constructor(readonly raw: SvmPipelineTransport) {}

  async build(
    input: PipelineOperationBuildInput | SvmDirectInput,
    options?: PipelineMutationOptions,
  ): Promise<SvmBuild> {
    if ("kind" in input) {
      return (await this.stage(input, options)).simulate(options);
    }
    const build = options
      ? await this.raw.build(input, options)
      : await this.raw.build(input);
    return new SvmBuild(build, this.raw);
  }

  async stage(
    input: SvmStageInput,
    options?: PipelineMutationOptions,
  ): Promise<SvmStaged> {
    const build = options
      ? await this.raw.stage(input, options)
      : await this.raw.stage(input);
    return new SvmStaged(build, this.raw);
  }

  async simulate(
    build: SvmStaged | SvmStagedBuild,
    options?: PipelineMutationOptions,
  ): Promise<SvmBuild> {
    const value = build instanceof SvmStaged ? build.raw : build;
    const simulated = options
      ? await this.raw.simulate(value, options)
      : await this.raw.simulate(value);
    return new SvmBuild(simulated, this.raw);
  }

  commit(
    build: SvmBuild | SvmSimulatedBuild,
    options?: PipelineCommitOptions,
  ): Promise<SvmCommitResult> {
    const value =
      build instanceof SvmBuild ? build : new SvmBuild(build, this.raw);
    return value.commit(options);
  }
}

export interface AomiOperationBuildOptions extends PipelineMutationOptions {
  /** Override Catalog metadata when integrating an older descriptor. */
  chainFamily?: "evm" | "svm";
}

export class AomiPipelineOperationScope {
  constructor(
    readonly raw: PipelineOperationTransport,
    private readonly evm: AomiEvmPipeline,
    private readonly svm: AomiSvmPipeline,
  ) {}

  directory() {
    return this.raw.directory();
  }

  operations() {
    return this.raw.operations();
  }

  operation(name: string): Promise<PipelineOperationDescriptor> {
    return this.raw.operation(name);
  }

  invoke<T = unknown>(
    name: string,
    args: Record<string, unknown>,
    options?: PipelineInvokeOptions,
  ): Promise<T> {
    return this.raw.invoke<T>(name, args, options);
  }

  async build(
    name: string,
    args: Record<string, unknown>,
    options: AomiOperationBuildOptions = {},
  ): Promise<EvmBuild | SvmBuild> {
    const descriptor = await this.raw.operation(name);
    validatePipelineArguments(args, descriptor.inputSchema);
    const { chainFamily: requestedChainFamily, ...mutationOptions } = options;
    const chainFamily =
      requestedChainFamily ?? descriptor.chainFamily ?? inferChainFamily(args);
    const transportOptions =
      Object.keys(mutationOptions).length > 0 ? mutationOptions : undefined;
    const input = {
      ...this.raw.executionScope,
      operation: descriptor.href,
      arguments: args,
    };
    return chainFamily === "svm"
      ? this.svm.build(input, transportOptions)
      : this.evm.build(input, transportOptions);
  }
}

export class AomiPipelineSkillScope extends AomiPipelineOperationScope {
  constructor(
    readonly skillRaw: PipelineSkillTransport,
    evm: AomiEvmPipeline,
    svm: AomiSvmPipeline,
  ) {
    super(skillRaw, evm, svm);
  }

  instructions(): Promise<string> {
    return this.skillRaw.instructions();
  }
}

export class AomiPipeline {
  readonly evm: AomiEvmPipeline;
  readonly svm: AomiSvmPipeline;

  constructor(
    readonly raw: PipelineTransport,
    client?: AomiClient,
    capabilities?: CommitCapabilities,
  ) {
    this.evm = new AomiEvmPipeline(raw.evm, client, capabilities);
    this.svm = new AomiSvmPipeline(raw.svm);
  }

  app(name: string): AomiPipelineOperationScope {
    return new AomiPipelineOperationScope(
      this.raw.app(name),
      this.evm,
      this.svm,
    );
  }

  skill(name: string): AomiPipelineSkillScope {
    return new AomiPipelineSkillScope(this.raw.skill(name), this.evm, this.svm);
  }
}

function inferChainFamily(args: Record<string, unknown>): "evm" | "svm" {
  return "cluster" in args || "instructions" in args || "transaction" in args
    ? "svm"
    : "evm";
}
