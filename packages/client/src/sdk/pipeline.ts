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
  constructor(readonly raw: EvmPipelineTransport) {}

  async build(
    input: PipelineOperationBuildInput | EvmDirectInput,
  ): Promise<EvmBuild> {
    if ("calls" in input) {
      return (await this.stage(input)).simulate();
    }
    return new EvmBuild(await this.raw.build(input), this.raw);
  }

  async stage(input: EvmStageInput | EvmDirectInput): Promise<EvmStaged> {
    const request: EvmStageInput =
      "actions" in input
        ? input
        : {
            actions: [
              {
                chainId: input.chainId,
                calls: input.calls,
                description: input.description,
              },
            ],
          };
    return new EvmStaged(await this.raw.stage(request), this.raw);
  }

  async simulate(build: EvmStaged | EvmStagedBuild): Promise<EvmBuild> {
    const value = build instanceof EvmStaged ? build.raw : build;
    return new EvmBuild(await this.raw.simulate(value), this.raw);
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
  ): Promise<SvmBuild> {
    if ("kind" in input) {
      return (await this.stage(input)).simulate();
    }
    return new SvmBuild(await this.raw.build(input), this.raw);
  }

  async stage(input: SvmStageInput): Promise<SvmStaged> {
    return new SvmStaged(await this.raw.stage(input), this.raw);
  }

  async simulate(build: SvmStaged | SvmStagedBuild): Promise<SvmBuild> {
    const value = build instanceof SvmStaged ? build.raw : build;
    return new SvmBuild(await this.raw.simulate(value), this.raw);
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

export interface AomiOperationBuildOptions {
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
    const chainFamily =
      options.chainFamily ?? descriptor.chainFamily ?? inferChainFamily(args);
    const input = { operation: descriptor.href, arguments: args };
    return chainFamily === "svm"
      ? this.svm.build(input)
      : this.evm.build(input);
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

  constructor(readonly raw: PipelineTransport) {
    this.evm = new AomiEvmPipeline(raw.evm);
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
