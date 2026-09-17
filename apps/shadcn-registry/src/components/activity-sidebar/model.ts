import type { Action, Event } from "@aomi-labs/client";
import { selectTaskRuns } from "@aomi-labs/react";
import { unwrapToolStep } from "../assistant-ui/tool-interpreter/unwrap";

type RecordValue = Record<string, unknown>;
export type ActivityTransaction = {
  id: string;
  sequence?: number;
  turnId: string | null;
  family: "evm" | "svm";
  label: string;
  kind: string;
  chainId?: number;
  cluster?: string;
  raw: RecordValue;
  stage: "staged" | "simulated" | "simulation-failed" | "committed";
  action?: Action;
  actionIndex?: number;
  committedWire?: string;
};

function record(value: unknown): RecordValue | undefined {
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}
const string = (value: unknown) =>
  typeof value === "string" ? value : undefined;
const number = (value: unknown) =>
  typeof value === "number" ? value : undefined;
const ids = (value: unknown): number[] =>
  Array.isArray(value)
    ? value.filter((id): id is number => typeof id === "number")
    : [];

/** Only complete tool records are projected; streamed child previews are not authoritative. */
function toolRecord(
  event: Event,
): { name: string; result: RecordValue } | undefined {
  let name: string, result: unknown;
  if (event.type === "message" && event.tool_result) {
    name = event.tool_name ?? event.tool_result[0];
    result = record(event.tool_result[1]);
  } else if (event.type === "tool_complete" || event.type === "tool_update") {
    name = event.tool_name;
    result = record(event.result);
  } else return;
  const unwrapped = unwrapToolStep({ toolName: name, result }).resultRecord;
  return unwrapped ? { name, result: unwrapped } : undefined;
}

function sameInstruction(raw: RecordValue, ix: RecordValue): boolean {
  return (
    Boolean(raw.program_id) &&
    ix.program_id === raw.program_id &&
    ix.data_base64 === raw.data_base64 &&
    JSON.stringify(ix.accounts) === JSON.stringify(raw.accounts)
  );
}

/** Match immutable transaction content, never labels or the ordinal in a batch. */
function sameTransaction(
  staged: ActivityTransaction,
  action: Action,
  index: number,
): boolean {
  const request = action.request;
  if (request.type === "execute_evm" && staged.family === "evm") {
    const tx = request.transactions[index];
    const raw = staged.raw;
    return (
      tx.chain_id === raw.chain_id &&
      tx.from.toLowerCase() === string(raw.from)?.toLowerCase() &&
      tx.to.toLowerCase() === string(raw.to)?.toLowerCase() &&
      tx.data.toLowerCase() === string(raw.data)?.toLowerCase() &&
      (tx.value ?? "0") === (raw.value ?? "0")
    );
  }
  if (request.type === "execute_svm" && staged.family === "svm") {
    const tx = request.transactions[index];
    if (
      tx.unsigned_transaction_base64 &&
      tx.unsigned_transaction_base64 === staged.committedWire
    )
      return true;
    if (
      tx.unsigned_transaction_base64 &&
      tx.unsigned_transaction_base64 ===
        staged.raw.unsigned_transaction_base64 &&
      tx.cluster === staged.cluster &&
      tx.payer === staged.raw.payer
    )
      return true;
    // Lane 1 instructions become one transaction at commit. Compare instruction
    // content after the backend strips its internal pending/lifecycle fields.
    const raw = staged.raw;
    return (
      tx.cluster === staged.cluster &&
      tx.payer === raw.payer &&
      Boolean(raw.program_id) &&
      tx.instructions.some((value) =>
        sameInstruction(raw, value as RecordValue),
      )
    );
  }
  return false;
}

export function selectActivity(
  events: readonly Event[],
  pendingActions: readonly Action[] = [],
) {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const turnId =
    [...ordered]
      .reverse()
      .find(
        (event) =>
          event.type === "message" && event.sender === "user" && event.turn_id,
      )?.turn_id ??
    [...ordered].reverse().find((event) => event.turn_id)?.turn_id ??
    null;
  const skills = new Set<string>();
  const staged = new Map<string, ActivityTransaction>();
  const actions = new Map<string, Action>();
  const actionOrder = new Map<string, number>();
  for (const event of ordered) {
    if (event.type === "action") {
      if (!actionOrder.has(event.id)) actionOrder.set(event.id, event.sequence);
      const prior = actions.get(event.id);
      if (!prior || prior.revision <= event.revision)
        actions.set(event.id, event);
      continue;
    }
    const tool = toolRecord(event);
    if (!tool || tool.result.error || tool.result.is_error === true) continue;
    const { name, result } = tool;
    if (Array.isArray(result.activated)) {
      for (const id of result.activated)
        if (typeof id === "string") skills.add(id);
    }
    const family =
      /svm|solana|jupiter/.test(name) || result.chain_kind === "svm"
        ? "svm"
        : "evm";
    // SVM staging wraps the assembled transaction in `tx` or `ix`.
    const stagedRecords = Array.isArray(result.instructions)
      ? result.instructions
      : [record(result.tx) ?? record(result.ix) ?? result];
    for (const raw of stagedRecords) {
      const tx = record(raw);
      if (!tx) continue;
      const pendingId = number(tx.pending_tx_id) ?? number(tx.pending_ix_id);
      if (pendingId != null && tx.current_lifecycle === "queued") {
        const id = `${event.turn_id}:${family}:${pendingId}`;
        const previous = staged.get(id);
        staged.set(id, {
          id,
          sequence: previous?.sequence ?? event.sequence,
          turnId: event.turn_id,
          family,
          label:
            string(tx.label) ??
            string(tx.description) ??
            `Transaction ${pendingId}`,
          kind: string(tx.kind) ?? "transaction",
          chainId: number(tx.chain_id),
          cluster: string(tx.cluster),
          raw: tx,
          stage: previous?.stage ?? "staged",
        });
      }
    }
    if (name === "jupiter_prepare_swap")
      for (const id of ids(result.ix_ids)) {
        const key = `${event.turn_id}:svm:${id}`;
        if (!staged.has(key))
          staged.set(key, {
            id: key,
            sequence: event.sequence,
            turnId: event.turn_id,
            family: "svm",
            label: string(result.description) ?? "Jupiter swap instruction",
            kind: "swap",
            cluster: string(result.cluster),
            raw: result,
            stage: "staged",
          });
      }
    const sim = record(result.simulation);
    if (sim) {
      const affected = ids(
        result.resolved_ids ??
          result.tx_ids ??
          result.ix_ids ??
          (typeof result.tx_id === "number" ? [result.tx_id] : []),
      );
      const success =
        typeof sim.batch_success === "boolean"
          ? sim.batch_success
          : "err" in sim
            ? sim.err == null
            : undefined;
      if (success !== undefined)
        for (const id of affected) {
          const item = staged.get(`${event.turn_id}:${family}:${id}`);
          if (item && !item.action)
            item.stage = success ? "simulated" : "simulation-failed";
        }
    }
    if (
      ["pending_approval", "broadcast_inflight", "aa_sign_request"].includes(
        String(result.status),
      )
    ) {
      for (const id of ids(
        result.tx_ids ?? result.svm_ix_ids ?? result.ix_ids,
      )) {
        const item = staged.get(`${event.turn_id}:${family}:${id}`);
        if (item) {
          item.stage = "committed";
          item.committedWire = string(result.unsigned_tx);
        }
      }
    }
  }
  for (const action of pendingActions) {
    const previous = actions.get(action.id);
    if (!previous || previous.revision <= action.revision)
      actions.set(action.id, action);
  }
  const transactions = [...staged.values()];
  for (const action of actions.values()) {
    const request = action.request;
    const count = request.type === "sign" ? 1 : request.transactions.length;
    for (let index = 0; index < count; index++) {
      let matches = transactions.filter(
        (tx) =>
          !tx.action &&
          tx.turnId === action.turn_id &&
          sameTransaction(tx, action, index),
      );
      if (
        request.type === "execute_svm" &&
        matches.length > 1 &&
        !matches[0].committedWire
      ) {
        // Preserve multiplicity: two identical staged instructions do not both
        // become signed when the assembled transaction contains only one.
        const candidates = [...matches];
        matches = [];
        for (const ix of request.transactions[index].instructions) {
          const found = candidates.findIndex((candidate) =>
            sameInstruction(candidate.raw, ix as RecordValue),
          );
          if (found >= 0) matches.push(...candidates.splice(found, 1));
        }
        if (!matches.length && candidates.length) matches = [candidates[0]];
      }
      const match = matches[0];
      if (match) {
        Object.assign(match, {
          stage: "committed",
          sequence:
            match.sequence ?? actionOrder.get(action.id) ?? action.sequence,
          turnId: action.turn_id,
          action,
          actionIndex: index,
        });
        if (request.type === "execute_svm") {
          const assembled = request.transactions[index];
          match.label = assembled.description || match.label;
          match.raw = assembled as unknown as RecordValue;
          for (const duplicate of matches.slice(1))
            transactions.splice(transactions.indexOf(duplicate), 1);
        }
        continue;
      }
      const raw = (request.type === "sign"
        ? request
        : request.transactions[index]) as unknown as RecordValue;
      transactions.push({
        id: `${action.id}:${index}`,
        sequence: actionOrder.get(action.id) ?? action.sequence,
        turnId: action.turn_id,
        family:
          request.type === "execute_svm" ||
          (request.type === "sign" && request.chainFamily === "svm")
            ? "svm"
            : "evm",
        label:
          string(raw.label) ??
          string(raw.description) ??
          (request.type === "sign"
            ? "Sign wallet request"
            : `Transaction ${index + 1}`),
        kind:
          request.type === "sign"
            ? "signature"
            : (string(raw.kind) ?? "transaction"),
        chainId: number(raw.chain_id) ?? number(raw.chainId),
        cluster: string(raw.cluster),
        raw,
        stage: "committed",
        action,
        actionIndex: index,
      });
    }
  }
  return {
    turnId,
    agents: Object.values(selectTaskRuns(ordered)),
    skills: [...skills],
    history: transactions.filter((tx) =>
      tx.action ? tx.action.state !== "pending" : tx.turnId !== turnId,
    ),
    transactions: transactions.filter(
      (tx) => tx.turnId === turnId || tx.action?.state === "pending",
    ),
  };
}
