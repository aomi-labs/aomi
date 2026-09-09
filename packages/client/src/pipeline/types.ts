import type { components } from "../generated/agent-v1/types";
import type { ActionRequest } from "../agent/types";

type Schemas = components["schemas"];

/** JSON Schema as returned by the live Pipeline Catalog. */
export type PipelineJsonSchema = boolean | Record<string, unknown>;

export type PipelineDirectoryEntryKind = "directory" | "operation" | "document";

export interface PipelineDirectoryEntry {
  name: string;
  kind: PipelineDirectoryEntryKind;
  href: string;
  description?: string;
}
export interface PipelineDirectory {
  kind: "directory";
  path: string;
  entries: PipelineDirectoryEntry[];
}

export interface PipelineOperationDescriptor {
  kind: "operation";
  name: string;
  description: string;
  method: "POST";
  href: string;
  inputSchema: PipelineJsonSchema;
  outputSchema?: PipelineJsonSchema;
  chainFamily?: "evm" | "svm";
}

export interface PipelineDocument {
  kind: "document";
  name: string;
  href: string;
  mediaType: string;
  content: string;
}

export type PipelineFilesystemResource =
  | PipelineDirectory
  | PipelineOperationDescriptor
  | PipelineDocument;

export interface PipelineOperationInvocation<
  Arguments extends Record<string, unknown> = Record<string, unknown>,
> {
  operation: string;
  arguments: Arguments;
}

export interface PipelineExecutionScope {
  app?: string;
  skills?: string[];
}

export type PipelineOperationBuildInput<
  Arguments extends Record<string, unknown> = Record<string, unknown>,
> = PipelineExecutionScope &
  (
    | PipelineOperationInvocation<Arguments>
    | { operations: PipelineOperationInvocation<Arguments>[] }
  );

export interface PipelineBuildProvenance {
  app: string;
  skills?: string[];
  operations: PipelineOperationInvocation[];
}

export interface PipelineMutationOptions {
  idempotencyKey?: string;
  paymentSignature?: string;
}

export interface PipelineInvokeOptions extends PipelineMutationOptions {
  /** Validate arguments against the live operation descriptor before POSTing. */
  validate?: boolean;
}

export interface PipelineCommitOptions extends PipelineMutationOptions {
  /** Defaults to the portable Build digest, making repeated commits stable. */
  idempotencyKey?: string;
}

export type PipelineSimulation = Schemas["PipelineSimulation"];
export type PipelineSimulationStatus = PipelineSimulation["status"];
export type PipelineBalanceChange = Schemas["PipelineBalanceChange"];
export type PipelineAssetStandard = NonNullable<
  PipelineBalanceChange["standard"]
>;
export type PipelineApprovalChange = Schemas["PipelineApprovalChange"];
export type PipelineApprovalKind = PipelineApprovalChange["kind"];
export type PipelineFeeEstimate = Schemas["PipelineFeeEstimate"];
export type PipelineGuardResult = Schemas["PipelineGuardResult"];
export type PipelineGasEstimate = Schemas["PipelineGasEstimate"];
export type PipelineLog = Schemas["PipelineLog"];

/** Server-authored Build summary. The wire schema leaves it open, so this is a
 * structural view of the fields the server emits today; unknown fields pass
 * through untouched. */
export interface PipelineActionSummary {
  title?: string;
  description?: string;
  actionCount?: number;
  transactionCount?: number;
  assetsIn?: PipelineBalanceChange[] | string[];
  assetsOut?: PipelineBalanceChange[] | string[];
  contracts?: string[];
  programs?: string[];
  chains?: Array<number | string>;
  [key: string]: unknown;
}

export interface EvmCallInput {
  to: `0x${string}`;
  data?: `0x${string}`;
  /** bigint is accepted at the SDK boundary and encoded as a decimal string. */
  value?: bigint | string;
  gas?: bigint | string;
  description?: string;
}

export interface EvmCall extends Omit<EvmCallInput, "value" | "gas"> {
  value?: string;
  gas?: string;
}

/** Canonical evm_stage_tx arguments, carried unchanged by the raw transport. */
export interface EvmStageActionInput {
  to: string;
  description: string;
  data: { signature: string; args: string[]; raw: string };
  chain_id?: number;
  value?: bigint | string;
  gas_limit?: bigint | string;
  expires_at?: number;
  kind?: string;
  protocol?: string;
  routed_plan_id?: string;
}

export interface EvmStageInput extends PipelineExecutionScope {
  actions: EvmStageActionInput[];
}

/** Fluent call input; the SDK converts each call to evm_stage_tx arguments. */
export interface EvmDirectInput extends PipelineExecutionScope {
  chainId: number;
  calls: EvmCallInput[];
  description?: string;
}

export type EvmStagedAction = Schemas["AssembledEvmTransaction"];
export type EvmPresentedAction = EvmStagedAction & { chainFamily: "evm" };

export interface EvmStagedBuild {
  version: 1;
  status: "staged";
  actions: EvmStagedAction[];
  provenance: PipelineBuildProvenance;
  digest: string;
}

export interface EvmSimulatedBuild {
  version: 1;
  status: "simulated";
  actions: EvmStagedAction[];
  provenance: PipelineBuildProvenance;
  simulation: PipelineSimulation;
  summary?: PipelineActionSummary;
  digest: string;
}

export interface EvmCommitResult {
  status: "committed";
  digest: string;
  /** Output of the selected commit operation. */
  result: unknown;
  /** Wallet intents emitted by stateless execution; these have no durable Action IDs. */
  requests: ActionRequest[];
}

export type SvmAccountMeta =
  Schemas["AssembledSvmInstruction"]["accounts"][number];

export type SvmInstruction = {
  program_id: string;
  accounts?: SvmAccountMeta[];
  description?: string;
  kind?: string;
} & (
  | { data_base64: string; encode?: never }
  | {
      data_base64?: never;
      encode: {
        instruction: string;
        /** JSON-encoded semantic argument object. */
        args?: string;
        /** JSON-encoded account-name to public-key mapping. */
        account_pubkeys?: string;
      };
    }
);

/** One invocation of svm_stage_ix. Each instruction receives its own record. */
export interface SvmInstructionBatch {
  instructions: SvmInstruction[];
  description: string;
  kind?: string;
  version?: "legacy" | "v0";
  address_lookup_tables?: string[];
  compute_units?: number;
  priority_microlamports?: number;
  broadcaster?: "wallet" | "venue" | "hosted";
  commitment?: string;
}

/** Canonical svm_stage_tx arguments for a venue-supplied base64 transaction. */
export interface SvmTransaction {
  tx: string;
  description?: string;
  kind?: string;
  preserve_blockhash?: boolean;
  broadcaster?: "wallet" | "venue" | "hosted";
}

export type SvmStageInput = PipelineExecutionScope &
  (
    | { kind: "instructions"; instructions: SvmInstructionBatch[] }
    | { kind: "transaction"; transaction: SvmTransaction }
  );

export type SvmDirectInput = SvmStageInput;

export type SvmAssembledAccountMeta = SvmAccountMeta;
export type AssembledSvmInstruction = Schemas["AssembledSvmInstruction"];

export type SvmStagedAction =
  | {
      lane: "instruction";
      id: number;
      instruction: Schemas["AssembledSvmInstruction"];
    }
  | {
      lane: "transaction";
      id: number;
      transaction: Schemas["AssembledSvmTransaction"];
    };

export type SvmBuildAction = SvmStagedAction;
export type SvmPresentedAction = SvmStagedAction & { chainFamily: "svm" };

export interface SvmStagedBuild {
  version: 1;
  status: "staged";
  actions: SvmStagedAction[];
  provenance: PipelineBuildProvenance;
  digest: string;
}

export interface SvmSimulatedBuild {
  version: 1;
  status: "simulated";
  actions: SvmStagedAction[];
  provenance: PipelineBuildProvenance;
  simulation: PipelineSimulation;
  summary?: PipelineActionSummary;
  digest: string;
}

export interface SvmCommitResult {
  status: "committed";
  digest: string;
  /** Outputs of the selected instruction/transaction commit operations. */
  results: unknown[];
  /** Wallet intents emitted by stateless execution; these have no durable Action IDs. */
  requests: ActionRequest[];
}
export type PipelineErrorBody = Schemas["ErrorEnvelope"];
