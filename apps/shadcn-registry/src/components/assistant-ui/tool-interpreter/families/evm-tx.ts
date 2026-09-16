import { EVM_SELECTOR_REGISTRY } from "@/components/assistant-ui/tool-registry";

import {
  asNumber,
  asRecord,
  asString,
  chainFact,
  chainFactFromRecord,
  chainFactFromText,
  humanize,
  selectorFact,
  statusFact,
  uniqueFacts,
} from "../normalize";
import type { ToolFact, ToolMatcher, ToolOperation } from "../types";

const op = (
  id: string,
  rawLabel: string,
  facts: Array<ToolFact | null>,
): ToolOperation => ({
  id,
  facts: uniqueFacts(facts.filter((fact): fact is ToolFact => fact != null)),
  confidence: "high",
  rawLabel,
});

const stagedActionId = (action: string): string =>
  action
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "custom";

export const matchStagedTx: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!resultRecord || resultRecord.current_lifecycle !== "queued") {
    return null;
  }

  const chain = chainFactFromRecord(resultRecord);
  if (!chain) return null;

  const data = asString(resultRecord.data);
  const selector = data ? selectorFact(data) : null;
  const selectorMeta = selector ? EVM_SELECTOR_REGISTRY[selector.value] : null;
  const kind = asString(resultRecord.kind);
  const action = selectorMeta?.chip ?? kind;
  const pendingTxId = asNumber(resultRecord.pending_tx_id);

  return op(`evm.tx.stage.${stagedActionId(action ?? "custom")}`, rawLabel, [
    chain,
    action
      ? {
          kind: "action",
          value: action,
          label: humanize(action),
          source: selectorMeta ? "decoded" : "result",
        }
      : null,
    pendingTxId != null
      ? {
          kind: "count",
          role: "tx",
          value: String(pendingTxId),
          source: "result",
        }
      : null,
    statusFact(resultRecord.current_lifecycle),
  ]);
};

export const matchEvmSimulation: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!resultRecord) return null;
  const sim =
    typeof resultRecord.simulation === "object" && resultRecord.simulation
      ? (resultRecord.simulation as Record<string, unknown>)
      : null;
  if (!(sim || "batch_success" in resultRecord)) return null;

  const chain =
    chainFactFromRecord(resultRecord) ?? chainFact(undefined, sim?.network);
  if (!chain) return null;

  const explicitBatchSuccess = sim?.batch_success ?? resultRecord.batch_success;
  const simulationStatus =
    explicitBatchSuccess !== undefined
      ? explicitBatchSuccess
      : sim && "err" in sim
        ? sim.err == null
        : resultRecord.last_batch_status;
  const gas = asNumber(sim?.total_gas) ?? asNumber(resultRecord.total_gas);
  const steps = Array.isArray(sim?.steps)
    ? sim.steps.length
    : Array.isArray(resultRecord.tx_ids)
      ? resultRecord.tx_ids.length
      : undefined;

  return op("evm.tx.simulate_batch", rawLabel, [
    chain,
    steps != null
      ? {
          kind: "count",
          role: "tx",
          value: String(steps),
          source: "result",
        }
      : null,
    statusFact(simulationStatus),
    gas != null
      ? {
          kind: "gas",
          value: String(gas),
          source: "result",
        }
      : null,
  ]);
};

export const matchEvmPendingApproval: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
  relatedResultRecords,
}) => {
  if (
    !resultRecord ||
    resultRecord.status !== "pending_approval" ||
    resultRecord.chain_kind === "svm" ||
    Array.isArray(resultRecord.svm_ix_ids)
  ) {
    return null;
  }

  const args = asRecord(parsedArgs);
  const txIds = Array.isArray(resultRecord.tx_ids)
    ? resultRecord.tx_ids
    : Array.isArray(args?.tx_ids)
      ? args.tx_ids
      : [];
  const stagedIds = new Set(
    txIds.filter(
      (value): value is number =>
        typeof value === "number" && Number.isInteger(value),
    ),
  );
  const relatedChain = [...relatedResultRecords].reverse().find((record) => {
    const pendingId = asNumber(record.pending_tx_id);
    return pendingId != null && stagedIds.has(pendingId);
  });
  const chain =
    chainFactFromRecord(resultRecord) ??
    chainFactFromRecord(args, "args") ??
    chainFactFromRecord(relatedChain) ??
    chainFactFromText(rawLabel);
  const outcome = asRecord(resultRecord.tx_outcome);
  const txHash = asString(outcome?.txHash);

  return op("evm.tx.pending_approval", rawLabel, [
    chain,
    txIds.length > 0
      ? {
          kind: "count",
          role: "tx",
          value: String(txIds.length),
          source: "result",
        }
      : null,
    txHash
      ? {
          kind: "txId",
          value: txHash,
          source: "result",
        }
      : null,
    // The canonical model rewrites the tool result on resolution, so a record
    // still shaped as pending_approval is pending; an inline tx_outcome only
    // appears on pre-cutover persisted results and still wins when present.
    statusFact(outcome?.status ?? resultRecord.status ?? "pending_approval"),
  ]);
};
