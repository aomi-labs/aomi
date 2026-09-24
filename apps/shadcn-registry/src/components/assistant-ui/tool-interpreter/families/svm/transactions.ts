import {
  asNumber,
  asRecord,
  asString,
  statusFact,
  uniqueFacts,
} from "../../normalize";
import { toolIdentity } from "../../identity";
import type { ToolFact, ToolMatcher, ToolOperation } from "../../types";
import { svmClusterFact } from "./context";
import {
  commitCountFact,
  commitStateFact,
  commitViews,
} from "../general/commit-view";

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

const clusterFact = (value: unknown): ToolFact | null =>
  asString(value) ? svmClusterFact(value) : null;

const failedFact = (result: Record<string, unknown> | null): ToolFact | null =>
  result && (result.is_error === true || result.error)
    ? statusFact("failed")
    : null;

const countFact = (
  ids: unknown,
  role: "tx" | "instruction",
): ToolFact | null =>
  Array.isArray(ids)
    ? { kind: "count", role, value: String(ids.length), source: "result" }
    : null;

export const matchSvmStage: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  const name = toolIdentity(rawLabel);
  if (name !== "svm_stage_ix" && name !== "svm_stage_tx") return null;
  const args = asRecord(parsedArgs);
  const storedTx = asRecord(resultRecord?.tx);
  const instructions = Array.isArray(resultRecord?.instructions)
    ? resultRecord.instructions
    : [];
  const firstIx = asRecord(instructions[0]);
  const count =
    name === "svm_stage_ix"
      ? (countFact(resultRecord?.ix_ids, "instruction") ??
        countFact(args?.instructions, "instruction"))
      : asNumber(resultRecord?.pending_tx_id) != null
        ? {
            kind: "count" as const,
            role: "tx" as const,
            value: "1",
            source: "result" as const,
          }
        : null;
  return op("svm.tx.stage", rawLabel, [
    clusterFact(resultRecord?.cluster ?? storedTx?.cluster ?? firstIx?.cluster),
    count,
    failedFact(resultRecord) ?? (resultRecord ? statusFact("staged") : null),
  ]);
};

const isSvmSimulation = (
  result: Record<string, unknown>,
  simulation: Record<string, unknown> | null,
): boolean =>
  simulation != null &&
  (result.chain_kind === "svm" ||
    ((Array.isArray(result.ix_ids) || asNumber(result.tx_id) != null) &&
      ("units_consumed" in simulation || Array.isArray(simulation.logs))));

export const matchSvmSimulation: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  const name = toolIdentity(rawLabel);
  const named = name === "svm_simulate_ix" || name === "svm_simulate_tx";
  const simulation = asRecord(resultRecord?.simulation);
  if (!named && (!resultRecord || !isSvmSimulation(resultRecord, simulation)))
    return null;
  const args = asRecord(parsedArgs);
  const status =
    failedFact(resultRecord) ??
    (resultRecord?.simulation_incomplete === true
      ? statusFact("incomplete")
      : simulation && "err" in simulation
        ? statusFact(simulation.err == null ? "passed" : "failed")
        : null);
  const compute = asNumber(simulation?.units_consumed);
  return op("svm.tx.simulate_batch", rawLabel, [
    clusterFact(resultRecord?.cluster),
    simulation
      ? { kind: "count", role: "tx", value: "1", source: "result" }
      : name === "svm_simulate_ix"
        ? countFact(args?.ix_ids, "instruction")
        : null,
    compute != null
      ? { kind: "compute", value: String(compute), source: "result" }
      : null,
    status,
  ]);
};

export const matchSvmPendingApproval: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  const name = toolIdentity(rawLabel);
  const views = commitViews(resultRecord);
  const named = name === "svm_commit_txs";
  const legacy =
    resultRecord?.status === "pending_approval" &&
    (resultRecord.chain_kind === "svm" ||
      Array.isArray(resultRecord.svm_ix_ids));
  if (!named && !legacy) return null;
  const args = asRecord(parsedArgs);
  const first = views[0];
  const chainRef = views.every(
    (view) =>
      view.chain_family === "svm" && view.chain_ref === first?.chain_ref,
  )
    ? asString(first?.chain_ref)
    : undefined;
  const cluster = chainRef?.startsWith("svm:")
    ? chainRef.slice(4)
    : resultRecord?.cluster;
  const requested = Array.isArray(args?.tx_ids) ? args.tx_ids : [];
  return op("svm.tx.pending_approval", rawLabel, [
    clusterFact(cluster),
    commitCountFact(views) ??
      (requested.length > 1 && !Array.isArray(resultRecord?.svm_ix_ids)
        ? {
            kind: "count",
            role: "tx",
            value: String(requested.length),
            source: "args",
          }
        : resultRecord || requested.length > 0
          ? { kind: "count", role: "tx", value: "1", source: "result" }
          : null),
    failedFact(resultRecord) ??
      commitStateFact(views) ??
      statusFact(
        resultRecord?.status ?? (resultRecord ? "pending_approval" : "pending"),
      ),
  ]);
};
