import { asRecord, asString, statusFact, uniqueFacts } from "../normalize";
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

const txCountFact = (ids: unknown): ToolFact | null =>
  Array.isArray(ids)
    ? {
        kind: "count",
        role: "tx",
        value: String(ids.length),
        source: "result",
      }
    : null;

const isSvmSimulation = (
  result: Record<string, unknown>,
  simulation: Record<string, unknown> | null,
): boolean => {
  if (result.chain_kind === "svm") return true;
  if (!Array.isArray(result.ix_ids)) return false;

  const batchStatus = asString(result.last_batch_status)?.toLowerCase();
  return Boolean(
    batchStatus?.includes("svm") ||
    simulation?.units_consumed != null ||
    Array.isArray(simulation?.logs),
  );
};

export const matchSvmSimulation: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!resultRecord) return null;
  const simulation = asRecord(resultRecord.simulation);
  if (!simulation || !isSvmSimulation(resultRecord, simulation)) return null;

  const simulationStatus =
    "err" in simulation
      ? simulation.err == null
      : resultRecord.last_batch_status;

  return op("svm.tx.simulate_batch", rawLabel, [
    txCountFact(resultRecord.ix_ids),
    statusFact(simulationStatus),
  ]);
};

export const matchSvmPendingApproval: ToolMatcher = ({
  rawLabel,
  resultRecord,
}) => {
  if (
    !resultRecord ||
    !(
      resultRecord.chain_kind === "svm" ||
      Array.isArray(resultRecord.svm_ix_ids)
    ) ||
    resultRecord.status !== "pending_approval"
  ) {
    return null;
  }

  return op("svm.tx.pending_approval", rawLabel, [
    txCountFact(resultRecord.svm_ix_ids),
    statusFact(resultRecord.status),
  ]);
};
