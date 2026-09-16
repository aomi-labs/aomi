import type { components } from "../generated/agent-v1/types";
import type { Action } from "../agent/types";

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

export type PipelineOperationBuildInput<
  Arguments extends Record<string, unknown> = Record<string, unknown>,
> =
  | PipelineOperationInvocation<Arguments>
  | { operations: PipelineOperationInvocation<Arguments>[] };

export interface PipelineInvokeOptions {
  /** Validate arguments against the live operation descriptor before POSTing. */
  validate?: boolean;
  idempotencyKey?: string;
  paymentSignature?: string;
}

export interface PipelineCommitOptions {
  /** Defaults to the portable Build digest, making repeated commits stable. */
  idempotencyKey?: string;
  paymentSignature?: string;
}

export type PipelineSimulation = Schemas["PipelineSimulation"];
export type PipelineSimulationStatus = PipelineSimulation["status"];
export type PipelineBalanceChange = Schemas["PipelineBalanceChange"];
export type PipelineFeeEstimate = Schemas["PipelineFeeEstimate"];
export type PipelineGuardResult = Schemas["PipelineGuardResult"];
export type PipelineGasEstimate = Schemas["PipelineGasEstimate"];
export type PipelineLog = Schemas["PipelineLog"];

export interface PipelineActionSummary {
  title?: string;
  description?: string;
  actionCount?: number;
  transactionCount?: number;
  assetsIn?: string[];
  assetsOut?: string[];
  contracts?: string[];
  programs?: string[];
  chains?: Array<number | string>;
}

export interface EvmCallInput {
  to: `0x${string}`;
  data?: `0x${string}`;
  /** bigint is accepted at the SDK boundary and encoded as a decimal string. */
  value?: bigint | string;
  from?: `0x${string}`;
  gas?: bigint | string;
  description?: string;
}

export interface EvmCall extends Omit<EvmCallInput, "value" | "gas"> {
  value?: string;
  gas?: string;
}

export interface EvmStageActionInput {
  chainId: number;
  calls: EvmCallInput[];
  description?: string;
}

export interface EvmStageInput {
  actions: EvmStageActionInput[];
}

export interface EvmDirectInput {
  chainId: number;
  calls: EvmCallInput[];
  description?: string;
}

export interface EvmStagedAction {
  id: string;
  chainFamily?: "evm";
  kind?: "calls";
  status?: string;
  chainId: number;
  calls: EvmCall[];
  description?: string;
}

export type EvmPresentedAction = EvmStagedAction & {
  chainFamily: "evm";
  kind: "calls";
};

export interface EvmStagedBuild {
  version: 1;
  status: "staged";
  actions: EvmStagedAction[];
  digest: string;
}

export interface EvmSimulatedBuild {
  version: 1;
  status: "simulated";
  actions: EvmStagedAction[];
  simulation: PipelineSimulation;
  summary?: PipelineActionSummary;
  digest: string;
}

export interface PipelineTransactionReceipt {
  id?: string;
  transactionId: string;
  status?: "submitted" | "confirmed" | "failed";
  chainId?: number;
  cluster?: string;
  blockNumber?: number | string;
}

export interface EvmCommitResult {
  version: 1;
  status: "committed" | "submitted" | "awaiting_wallet";
  digest: string;
  receipts?: PipelineTransactionReceipt[];
  action?: Action;
}

export interface SvmAccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface SvmInstruction {
  programId: string;
  accounts: SvmAccountMeta[];
  /** Base64 by default; an explicit encoding keeps byte semantics unambiguous. */
  data: string;
  encoding?: "base64" | "base58";
}

export interface SvmTransaction {
  transaction: string;
  encoding?: "base64";
  cluster?: string;
  feePayer?: string;
}

export type SvmStageInput =
  | {
      kind: "instructions";
      instructions: SvmInstruction[];
      cluster?: string;
      feePayer?: string;
    }
  | {
      kind: "transaction";
      transaction: SvmTransaction;
    };

export type SvmDirectInput = SvmStageInput;

export type SvmStagedAction =
  | {
      id: string;
      chainFamily?: "svm";
      kind: "instructions";
      status?: string;
      instructions: SvmInstruction[];
      cluster?: string;
      description?: string;
    }
  | {
      id: string;
      chainFamily?: "svm";
      kind: "transaction";
      status?: string;
      transaction: SvmTransaction;
      cluster?: string;
      description?: string;
    };

export type SvmPresentedAction = SvmStagedAction & { chainFamily: "svm" };

export interface SvmStagedBuild {
  version: 1;
  status: "staged";
  actions: SvmStagedAction[];
  digest: string;
}

export interface SvmSimulatedBuild {
  version: 1;
  status: "simulated";
  actions: SvmStagedAction[];
  simulation: PipelineSimulation;
  summary?: PipelineActionSummary;
  digest: string;
}

export interface SvmCommitResult {
  version: 1;
  status: "committed" | "submitted" | "awaiting_wallet";
  digest: string;
  receipts?: PipelineTransactionReceipt[];
  action?: Action;
}
export type PipelineErrorBody = Schemas["ErrorEnvelope"];
