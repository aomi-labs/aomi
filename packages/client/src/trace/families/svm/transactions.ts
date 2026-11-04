import {
  asNumber,
  asRecord,
  asString,
  humanize,
  statusFact,
} from "../../normalize";
import { toolIdentity } from "../../identity";
import type { ToolFact, ToolMatcher } from "../../types";
import { svmClusterFact } from "./context";
import {
  commitChainRef,
  commitCountFact,
  commitStateFact,
  commitTxIdFact,
  commitViews,
} from "../general/commit-view";
import { failedFact, operation } from "../operation";

const clusterFact = (value: unknown): ToolFact | null =>
  asString(value) ? svmClusterFact(value) : null;

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
  // The action, as EVM names a staged call: the instruction's kind, else the
  // IDL instruction the call encoded.
  const requested = Array.isArray(args?.instructions)
    ? asRecord(args.instructions[0])
    : null;
  const action =
    asString(firstIx?.kind) ??
    asString(storedTx?.kind) ??
    asString(args?.kind) ??
    asString(requested?.kind) ??
    asString(asRecord(requested?.encode)?.instruction);
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
  return operation("svm.tx.stage", rawLabel, [
    clusterFact(resultRecord?.cluster ?? storedTx?.cluster ?? firstIx?.cluster),
    count,
    action
      ? {
          kind: "action",
          value: action,
          label: humanize(action),
          source: firstIx?.kind || storedTx?.kind ? "result" : "args",
        }
      : null,
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

export const matchSvmSimulation: ToolMatcher = ({ rawLabel, resultRecord }) => {
  const named = toolIdentity(rawLabel) === "svm_simulate";
  const simulation = asRecord(resultRecord?.simulation);
  if (!named && (!resultRecord || !isSvmSimulation(resultRecord, simulation)))
    return null;
  const status =
    failedFact(resultRecord) ??
    (resultRecord?.simulation_incomplete === true
      ? statusFact("incomplete")
      : simulation && "err" in simulation
        ? statusFact(simulation.err == null ? "passed" : "failed")
        : null);
  // Steps that don't fit one transaction simulate as ordered legs, each with
  // its own simulation; one transaction reports at the top level.
  const legs = Array.isArray(resultRecord?.transactions)
    ? resultRecord.transactions
        .map((leg) => asRecord(asRecord(leg)?.simulation))
        .filter((leg): leg is Record<string, unknown> => leg != null)
    : simulation
      ? [simulation]
      : [];
  const units = legs
    .map((leg) => asNumber(leg.units_consumed))
    .filter((value): value is number => value != null);
  return operation("svm.tx.simulate_batch", rawLabel, [
    clusterFact(resultRecord?.cluster),
    legs.length > 0
      ? {
          kind: "count",
          role: "tx",
          value: String(legs.length),
          source: "result",
        }
      : null,
    units.length > 0
      ? {
          kind: "compute",
          value: String(units.reduce((sum, value) => sum + value, 0)),
          source: "result",
        }
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
  const cluster = commitChainRef(views, "svm") ?? resultRecord?.cluster;
  // Commit ids are usually instruction ids assembled into one transaction,
  // so they never count transactions: the commits do, else it is one.
  const requested = Array.isArray(args?.tx_ids) && args.tx_ids.length > 0;
  return operation("svm.tx.pending_approval", rawLabel, [
    clusterFact(cluster),
    commitCountFact(views) ??
      (resultRecord || requested
        ? { kind: "count", role: "tx", value: "1", source: "result" }
        : null),
    commitTxIdFact(views),
    failedFact(resultRecord) ??
      commitStateFact(views) ??
      statusFact(
        resultRecord?.status ?? (resultRecord ? "pending_approval" : "pending"),
      ),
  ]);
};
