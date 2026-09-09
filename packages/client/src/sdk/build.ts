import type {
  EvmPipelineTransport,
  SvmPipelineTransport,
} from "../pipeline/transport";
import type {
  EvmCommitResult,
  EvmPresentedAction,
  EvmSimulatedBuild,
  EvmStagedBuild,
  PipelineActionSummary,
  PipelineApprovalChange,
  PipelineBalanceChange,
  PipelineBuildOrigin,
  PipelineCommitOptions,
  PipelineMutationOptions,
  PipelineSimulation,
  SvmCommitResult,
  SvmPresentedAction,
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

  get actions(): EvmPresentedAction[] {
    return this.raw.actions.map((action) => ({
      ...action,
      chainFamily: "evm",
    }));
  }

  get digest(): string {
    return this.raw.digest;
  }

  get origin(): PipelineBuildOrigin {
    return this.raw.origin;
  }

  get expiresAt(): number {
    return this.raw.expiresAt;
  }

  get attestation(): string {
    return this.raw.attestation;
  }

  async simulate(options?: PipelineMutationOptions): Promise<EvmBuild> {
    return new EvmBuild(
      await this.transport.simulate(this.raw, options),
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

  get actions(): EvmPresentedAction[] {
    return this.raw.actions.map((action) => ({
      ...action,
      chainFamily: "evm",
    }));
  }

  get summary(): PipelineActionSummary | undefined {
    return this.raw.summary;
  }

  get simulation(): PipelineSimulation {
    return this.raw.simulation;
  }

  /** Wallet asset movements decoded from successful simulation steps. */
  get balanceChanges(): PipelineBalanceChange[] {
    return this.raw.simulation.balanceChanges;
  }

  /** Allowance, token, and operator permissions changed by the build. */
  get approvals(): PipelineApprovalChange[] {
    return this.raw.simulation.approvals;
  }

  get digest(): string {
    return this.raw.digest;
  }

  get origin(): PipelineBuildOrigin {
    return this.raw.origin;
  }

  get expiresAt(): number {
    return this.raw.expiresAt;
  }

  get attestation(): string {
    return this.raw.attestation;
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

  get actions(): SvmPresentedAction[] {
    return this.raw.actions.map((action) => ({
      ...action,
      chainFamily: "svm",
    }));
  }

  get digest(): string {
    return this.raw.digest;
  }

  get origin(): PipelineBuildOrigin {
    return this.raw.origin;
  }

  get expiresAt(): number {
    return this.raw.expiresAt;
  }

  get attestation(): string {
    return this.raw.attestation;
  }

  async simulate(options?: PipelineMutationOptions): Promise<SvmBuild> {
    return new SvmBuild(
      await this.transport.simulate(this.raw, options),
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

  get actions(): SvmPresentedAction[] {
    return this.raw.actions.map((action) => ({
      ...action,
      chainFamily: "svm",
    }));
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

  get origin(): PipelineBuildOrigin {
    return this.raw.origin;
  }

  get expiresAt(): number {
    return this.raw.expiresAt;
  }

  get attestation(): string {
    return this.raw.attestation;
  }

  async commit(options?: PipelineCommitOptions): Promise<SvmCommitResult> {
    return this.transport.commit(this.raw, options);
  }

  toJSON(): SvmSimulatedBuild {
    return this.raw;
  }
}
