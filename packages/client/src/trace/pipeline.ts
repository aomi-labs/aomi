import { coreToolTitle, declaredToolIdentity } from "./identity";
import {
  asRecord,
  chainFactFromRecord,
  statusFact,
  uniqueFacts,
} from "./normalize";
import { svmClusterFact } from "./families/svm/context";
import { coreMatchersFor } from "./families/core-matchers";
import { matchError } from "./families/general/errors";
import { presentOperation } from "./present/present-operation";
import { protocolMatcherFor } from "./protocols/protocol-matchers";
import type {
  InterpretedToolStep,
  ToolConfidence,
  ToolContext,
  ToolFact,
  ToolMatcher,
  ToolOperation,
} from "./types";

/** Identity selects an adapter; payload shape only determines facts inside it. */
const matchersFor = (name: string): ToolMatcher[] => {
  const protocol = protocolMatcherFor(name);
  return [
    ...(coreMatchersFor(name) ?? (protocol ? [protocol] : [])),
    matchError,
  ];
};

const fallbackOperation = (ctx: ToolContext) => {
  const name = declaredToolIdentity(ctx.rawLabel);
  const coreIds: Record<string, string> = {
    web_search: "web.search",
    brave_search: "web.search",
    web_fetch: "web.fetch",
    activate_skills: "skill.activate",
    get_contract: "evm.contract.lookup.found",
    list_transactions: "activity.transactions",
    get_transaction: "activity.transaction",
    encode_and_call: "evm.call.generic",
    sim_call: "evm.call.generic",
  };
  const coreId = Object.hasOwn(coreIds, name) ? coreIds[name] : undefined;
  const confidence: ToolConfidence = coreId ? "high" : "fallback";

  return {
    id: coreId ?? "fallback",
    facts: [],
    confidence,
    rawLabel: ctx.rawLabel,
    title: coreToolTitle(ctx.rawLabel),
  };
};

/** The records a staging tool returned under `staged`, one per pending tx. */
const stagedRecords = (ctx: ToolContext): Record<string, unknown>[] =>
  Array.isArray(ctx.resultRecord?.staged)
    ? ctx.resultRecord.staged
        .map((record) => asRecord(record))
        .filter((record): record is Record<string, unknown> => record != null)
    : [];

/**
 * Every staging tool returns its pending txs under `staged`, so the row shows
 * the network, how many txs were staged, and that they are queued, whichever
 * protocol built them. A protocol adapter may add its own facts on top.
 */
const withStaged = (
  operation: ToolOperation,
  ctx: ToolContext,
): ToolOperation => {
  const staged = stagedRecords(ctx);
  if (staged.length === 0) return operation;
  const base = operation.facts.filter(
    (fact) => !(fact.kind === "status" && fact.value === "success"),
  );
  const facts: Array<ToolFact | null> = [
    ...base,
    operation.facts.some(
      (fact) => fact.kind === "chain" || fact.kind === "cluster",
    )
      ? null
      : staged[0].chain_kind === "svm"
        ? svmClusterFact(staged[0].cluster)
        : chainFactFromRecord(staged[0]),
    {
      kind: "count",
      role: "tx",
      value: String(staged.length),
      source: "result",
    },
    base.some((fact) => fact.kind === "status") ? null : statusFact("queued"),
  ];
  return {
    ...operation,
    id: operation.id === "fallback" ? "protocol.prepare" : operation.id,
    confidence: operation.id === "fallback" ? "high" : operation.confidence,
    facts: uniqueFacts(facts.filter((fact): fact is ToolFact => fact != null)),
  };
};

export const interpretToolContext = (ctx: ToolContext): InterpretedToolStep => {
  const name = declaredToolIdentity(ctx.rawLabel);
  const operation = withStaged(
    matchersFor(name).reduce<ReturnType<ToolMatcher>>(
      (matched, matcher) => matched ?? matcher(ctx),
      null,
    ) ?? fallbackOperation(ctx),
    ctx,
  );

  const coreTitle = coreToolTitle(ctx.rawLabel);
  const keepsSemanticTitle =
    operation.id.startsWith("evm.call.erc20.") ||
    operation.id === "skill.check";
  return presentOperation({
    ...operation,
    title: keepsSemanticTitle
      ? operation.title
      : (coreTitle ?? operation.title),
  });
};
