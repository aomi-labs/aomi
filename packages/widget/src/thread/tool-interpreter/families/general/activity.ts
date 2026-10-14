import {
  addressFact,
  asRecord,
  asString,
  chainFact,
  chainFactFromRecord,
} from "@/thread/tool-interpreter/normalize";
import type { ToolFact, ToolMatcher } from "@/thread/tool-interpreter/types";
import {
  isErrorResult,
  operation,
} from "@/thread/tool-interpreter/families/operation";

const SOLANA = new Set([
  "solana",
  "sol",
  "svm",
  "mainnet-beta",
  "solana:mainnet-beta",
]);

const solanaFact = (source: ToolFact["source"]): ToolFact => ({
  kind: "cluster",
  value: "mainnet-beta",
  label: "Solana",
  source,
});

/** The one chain a history read was narrowed to; several or none means all. */
const chainArgFact = (chains: unknown): ToolFact | null => {
  const list = Array.isArray(chains) ? chains : chains == null ? [] : [chains];
  if (list.length !== 1) return null;
  const chain = String(list[0]).trim();
  if (SOLANA.has(chain.toLowerCase())) return solanaFact("args");
  return /^\d+$/.test(chain)
    ? chainFact(Number(chain), undefined, "args")
    : chainFact(undefined, chain, "args");
};

/** Chips mirror the question asked (chain, token, other side) and then how
 * many transactions answered it. */
export const matchListTransactions: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  if (resultRecord && isErrorResult(resultRecord)) return null;
  const args = asRecord(parsedArgs) ?? {};
  const direction = asString(args.direction);
  const token = asString(args.token)?.trim();
  const rows = resultRecord?.transactions;
  return operation("activity.transactions", rawLabel, [
    chainArgFact(args.chains),
    token
      ? { kind: "token", value: token, label: token, source: "args" }
      : null,
    addressFact(args.counterparty, direction === "in" ? "from" : "to", "args"),
    Array.isArray(rows)
      ? {
          kind: "count",
          role: "tx",
          value: String(rows.length),
          source: "result",
        }
      : null,
  ]);
};

/** The wallet's first balance change, signed: what the transaction did to it. */
const firstMove = (result: Record<string, unknown>): ToolFact | null => {
  const effects = asRecord(result.effects);
  const changes = Array.isArray(effects?.balance_changes)
    ? effects.balance_changes
    : Array.isArray(result.moves)
      ? result.moves
      : [];
  const change = asRecord(changes[0]);
  const amount = asString(change?.amount);
  if (!change || !amount) return null;
  const sign = change.direction === "out" ? "−" : "+";
  const symbol = asString(change.symbol) ?? "";
  return {
    kind: "amount",
    value: amount,
    label: `${sign}${amount}${symbol ? ` ${symbol}` : ""}`,
    source: "result",
  };
};

/** A read that returned the transaction. Earlier Solana reads put a failed
 * transaction's runtime error at the top level as `error`, beside its status;
 * that is the transaction failing, not the read. */
const isTransactionRead = (result: Record<string, unknown>): boolean =>
  result.is_error !== true &&
  typeof result.status === "string" &&
  Boolean(asString(result.transaction_hash) ?? asString(result.signature));

/** Network, hash, what moved for the wallet, and a warning when the
 * transaction itself reverted or is not yet mined. The read succeeded either
 * way, so the step keeps a successful outcome. */
export const matchGetTransaction: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  if (
    resultRecord &&
    isErrorResult(resultRecord) &&
    !isTransactionRead(resultRecord)
  )
    return null;
  const args = asRecord(parsedArgs) ?? {};
  const result = resultRecord ?? {};
  const hash =
    asString(result.transaction_hash) ??
    asString(result.signature) ??
    asString(args.hash);
  const status = asString(result.status);
  return operation("activity.transaction", rawLabel, [
    result.cluster ? solanaFact("result") : chainFactFromRecord(resultRecord),
    hash
      ? {
          kind: "txId",
          value: hash,
          source: hash === args.hash ? "args" : "result",
        }
      : null,
    firstMove(result),
    status === "failed" || status === "pending"
      ? {
          kind: "warning",
          value: status,
          label: status === "failed" ? "Reverted" : "Pending",
          source: "result",
        }
      : null,
  ]);
};
