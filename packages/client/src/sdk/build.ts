import type {
  EvmPipelineTransport,
  SvmPipelineTransport,
} from "../pipeline/transport";
import type {
  EvmCommitResult,
  EvmSimulatedBuild,
  EvmStagedBuild,
  PipelineActionSummary,
  PipelineCommitOptions,
  PipelineSimulation,
  SvmBuildAction,
  SvmCommitResult,
  SvmSimulatedBuild,
  SvmStagedBuild,
} from "../pipeline/types";

export class EvmStaged {
  constructor(
    readonly raw: EvmStagedBuild,
    private readonly transport: EvmPipelineTransport,
  ) {}

  get version(): 2 {
    return this.raw.version;
  }

  get status(): "staged" {
    return this.raw.status;
  }

  get actions(): EvmStagedBuild["actions"] {
    return this.raw.actions;
  }

  get digest(): string {
    return this.raw.digest;
  }

  async simulate(): Promise<EvmBuild> {
    return new EvmBuild(
      await this.transport.simulate(this.raw),
      this.transport,
    );
  }

  toJSON(): EvmStagedBuild {
    return this.raw;
  }
}

export class EvmBuild {
  constructor(
    readonly raw: EvmSimulatedBuild,
    private readonly transport: EvmPipelineTransport,
  ) {}

  get version(): 2 {
    return this.raw.version;
  }

  get status(): "simulated" {
    return this.raw.status;
  }

  get actions(): EvmSimulatedBuild["actions"] {
    return this.raw.actions;
  }

  get summary(): PipelineActionSummary | undefined {
    return this.raw.summary;
  }

  get simulation(): PipelineSimulation {
    return this.raw.simulation;
  }

  get digest(): string {
    return this.raw.digest;
  }

  async commit(options?: PipelineCommitOptions): Promise<EvmCommitResult> {
    return this.transport.commit(this.raw, options);
  }

  toJSON(): EvmSimulatedBuild {
    return this.raw;
  }
}

export class SvmStaged {
  constructor(
    readonly raw: SvmStagedBuild,
    private readonly transport: SvmPipelineTransport,
  ) {}

  get version(): 2 {
    return this.raw.version;
  }

  get status(): "staged" {
    return this.raw.status;
  }

  get actions(): SvmBuildAction[] {
    return this.raw.actions;
  }

  get digest(): string {
    return this.raw.digest;
  }

  async simulate(): Promise<SvmBuild> {
    return new SvmBuild(
      await this.transport.simulate(this.raw),
      this.transport,
    );
  }

  toJSON(): SvmStagedBuild {
    return this.raw;
  }
}

export class SvmBuild {
  constructor(
    readonly raw: SvmSimulatedBuild,
    private readonly transport: SvmPipelineTransport,
  ) {}

  get version(): 2 {
    return this.raw.version;
  }

  get status(): "simulated" {
    return this.raw.status;
  }

  get actions(): SvmBuildAction[] {
    return this.raw.actions;
  }

  get summary(): PipelineActionSummary | undefined {
    return this.raw.summary;
  }

  get simulation(): PipelineSimulation {
    return this.raw.simulation;
  }

  get digest(): string {
    return this.raw.digest;
  }

  async commit(options?: PipelineCommitOptions): Promise<SvmCommitResult> {
    return this.transport.commit(this.raw, options);
  }

  toJSON(): SvmSimulatedBuild {
    return this.raw;
  }
}
