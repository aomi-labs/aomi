import type { AomiClient } from "../client";
import { CommitController, type CommitCapabilities } from "../commits";
import type {
  EvmPipelineTransport,
  PipelineOperationsTransport,
  PipelineTransport,
  SvmPipelineTransport,
} from "../pipeline/transport";
import { validatePipelineArguments, withTopic } from "../pipeline/schema";
import type {
  EvmCommitResult,
  EvmDirectInput,
  EvmSimulatedBuild,
  EvmStageInput,
  EvmStagedBuild,
  PipelineCommitOptions,
  PipelineDirectory,
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
import { Build, EvmBuild, EvmStaged, SvmBuild, SvmStaged } from "./build";
import { CommitHandle } from "./commits";

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
            agent: input.agent,
            packages: input.packages,
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
  constructor(
    readonly raw: SvmPipelineTransport,
    private readonly client?: AomiClient,
    private readonly capabilities: CommitCapabilities = {},
  ) {}

  /** Follow a Solana commit's Commit Service commits. */
  commits(
    preparation: SvmCommitResult,
    capabilities = this.capabilities,
  ): CommitController {
    const { thread_id: threadId, commits } = preparation;
    if (!this.client || !threadId || !commits?.length)
      throw new Error("Durable Pipeline continuation is unavailable");
    if (
      commits.some(
        (view) => view.chain_family !== "svm" || view.thread_id !== threadId,
      )
    )
      throw new Error("Pipeline cohort identity mismatch");
    const controller = new CommitController(
      this.client,
      threadId,
      capabilities,
      "pipeline",
    );
    for (const view of commits) controller.ingest(view);
    return controller;
  }

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

/** The operations an agent may run, or only one package's of them. */
export class AomiPipelineOperationScope {
  constructor(
    readonly raw: PipelineOperationsTransport,
    private readonly evm: AomiEvmPipeline,
    private readonly svm: AomiSvmPipeline,
  ) {}

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
    args = withTopic(args, name, descriptor.inputSchema);
    validatePipelineArguments(args, descriptor.inputSchema);
    const { chainFamily: requestedChainFamily, ...mutationOptions } = options;
    const chainFamily =
      requestedChainFamily ??
      descriptor.chainFamily ??
      inferChainFamily(name, args);
    const transportOptions =
      Object.keys(mutationOptions).length > 0 ? mutationOptions : undefined;
    const input = {
      ...this.raw.executionScope,
      // The agent goes on the Build's own query, not in the operation path.
      operation: descriptor.href.split("?")[0]!,
      arguments: args,
    };
    return chainFamily === "svm"
      ? this.svm.build(input, transportOptions)
      : this.evm.build(input, transportOptions);
  }
}

/** Who a call runs as: `agent`, `publisher/name` (none is `aomi/main`),
 * and optionally only `package`'s operations. */
export interface AomiPipelineScope {
  agent?: string;
  package?: string;
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
    this.svm = new AomiSvmPipeline(raw.svm, client, capabilities);
  }

  /** The packages on for `agent`. */
  packages(options: { agent?: string } = {}): Promise<PipelineDirectory> {
    return this.raw.agent(options.agent).packages();
  }

  operations(options: AomiPipelineScope = {}): Promise<PipelineDirectory> {
    return this.scope(options).operations();
  }

  invoke<T = unknown>(
    name: string,
    args: Record<string, unknown>,
    options: PipelineInvokeOptions & AomiPipelineScope = {},
  ): Promise<T> {
    const { agent, package: id, ...invokeOptions } = options;
    return this.scope({ agent, package: id }).invoke<T>(
      name,
      args,
      invokeOptions,
    );
  }

  /**
   * Stage and simulate one operation. Nothing is signed until `commit()`.
   * EVM or Solana follows from the operation.
   */
  async build(
    name: string,
    args: Record<string, unknown>,
    options: AomiOperationBuildOptions & AomiPipelineScope = {},
  ): Promise<Build> {
    const { agent, package: id, ...buildOptions } = options;
    return new Build(
      await this.scope({ agent, package: id }).build(name, args, buildOptions),
      (result) => {
        const controller =
          result.family === "svm"
            ? this.svm.commits(result)
            : this.evm.commits(result);
        const leader = controller.all().find((view) => !view.batch?.index);
        if (!leader) throw new Error("Pipeline commit has no commits");
        return new CommitHandle(leader.commit_id, controller);
      },
    );
  }

  scope({
    agent,
    package: id,
  }: AomiPipelineScope = {}): AomiPipelineOperationScope {
    const raw = this.raw.agent(agent);
    return new AomiPipelineOperationScope(
      id ? raw.package(id) : raw,
      this.evm,
      this.svm,
    );
  }
}

function inferChainFamily(
  operation: string,
  args: Record<string, unknown>,
): "evm" | "svm" {
  return operation.startsWith("svm_") ||
    "cluster" in args ||
    "instructions" in args ||
    "transaction" in args
    ? "svm"
    : "evm";
}
