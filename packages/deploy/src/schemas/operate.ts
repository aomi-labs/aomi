/**
 * The Operate surface: transactions, usage, statements, partner payments, logs, observability
 * and an agent's detail. Each read is one result over the agents the builder's publisher owns,
 * narrowed by project or agent; rows name their project, which may be none.
 */
import { z } from "zod";

import { AgentPricingSnapshot, Project } from "./deploy";
import {
  flag,
  isRecord,
  list,
  maybe,
  maybeList,
  maybeNum,
  maybeText,
  num,
  oneOf,
  seconds,
  text,
  wire,
} from "./wire";

/** A row tagged with the project and platform it came from; both null for a project-less agent. */
const tagged = { projectId: maybeNum, platform: maybeText };

// ── Transactions ──────────────────────────────────────────────────────────

const transaction = {
  id: text(),
  externalTxId: text(),
  agent: text(),
  agentId: maybeNum,
  status: text(),
  /** EVM tx hash or SVM signature. */
  txHash: maybeText,
  chainId: num(0),
  fromAddress: text(),
  toAddress: text(),
  value: text("0"),
  hasCalldata: flag,
  calldataPreview: maybeText,
  description: maybeText,
  createdAt: seconds,
  updatedAt: seconds,
  submittedAt: z
    .unknown()
    .transform((value) => (value == null ? null : seconds.parse(value))),
  // The receipt contract, null until the confirmation watcher lands.
  family: oneOf(["evm", "svm"], null),
  chainName: maybeText,
  fromLabel: maybeText,
  toLabel: maybeText,
  valueUsd: maybeText,
  block: maybeText,
  slot: maybeText,
  confirmations: maybeNum,
  gasUsed: maybeText,
  gasLimit: maybeText,
  effGasPrice: maybeText,
  computeUnits: maybeText,
  computeLimit: maybeText,
  priorityFee: maybeText,
  txFee: maybeText,
  platformFee: maybeText,
  nonce: maybeNum,
  method: maybeText,
  transfers: maybeList(z.unknown().transform(String)),
  revertReason: maybeText,
  explorerUrl: maybeText,
};

export const OperateTransaction = wire(transaction);
export type OperateTransaction = z.output<typeof OperateTransaction>;

/** The next page, or null when the manager sends no complete cursor. */
export const OperateTransactionCursor = maybe(
  wire({ createdAt: seconds, id: text() }),
).transform((cursor) => (cursor?.createdAt && cursor.id ? cursor : null));
export type OperateTransactionCursor = NonNullable<
  z.output<typeof OperateTransactionCursor>
>;

/** A real project among the agents in scope and the platform it resolves under. */
export const UserProjectRef = wire({ project: Project, platform: text() });
export type UserProjectRef = z.output<typeof UserProjectRef>;

const scope = {
  scope: text("owned_agents"),
  projects: list(UserProjectRef),
};

/** Transactions: one newest-first page with one cursor. */
export const UserTransactionsResult = wire({
  projects: list(UserProjectRef),
  transactions: list(wire({ ...transaction, ...tagged })),
  nextCursor: OperateTransactionCursor,
});
export type UserTransactionsResult = z.output<typeof UserTransactionsResult>;
export type UserTransactionRow = UserTransactionsResult["transactions"][number];

// ── Usage and the statement ───────────────────────────────────────────────

const tokens = {
  inputTokens: num(0),
  outputTokens: num(0),
  creditsUsed: num(0),
};

export const OperateUsageResult = wire({
  ...scope,
  range: wire({ fromDate: text(), toDate: text(), maxDays: num(90) }),
  daily: list(
    wire({
      periodUtcDay: text(),
      agent: text(),
      agentId: num(0),
      projectId: maybeNum,
      ...tokens,
    }),
  ),
  breakdown: list(
    wire({
      provider: text(),
      model: text(),
      paymentMethod: text(),
      ...tokens,
      events: num(0),
    }),
  ),
});
export type OperateUsageResult = z.output<typeof OperateUsageResult>;

export const OperatePartnerPayments = wire({
  available: flag,
  scope: text("recipient_bucket"),
  summary: wire({
    accruedCredits: num(0),
    accruedUsd: num(0),
    settledCredits: num(0),
    settledUsd: num(0),
    outstandingCredits: num(0),
    outstandingUsd: num(0),
    pricedCalls: num(0),
    settlements: num(0),
  }),
  resources: list(
    wire({
      agent: text(),
      agentId: maybeNum,
      tool: text(),
      flatCredits: num(0),
      flatUsd: num(0),
      beneficiary: maybeText,
      recipient: maybeText,
      chain: maybeText,
      beneficiaryType: maybeText,
      observedCalls: num(0),
    }),
  ),
  buckets: list(
    wire({
      id: text(),
      recipient: text(),
      outstandingCredits: num(0),
      outstandingUsd: num(0),
    }),
  ),
  events: list(
    wire({
      id: text(),
      kind: text(),
      occurredAt: seconds,
      agent: maybeText,
      agentId: maybeNum,
      tools: list(z.unknown().transform(String)),
      credits: num(0),
      usd: num(0),
      asset: maybeText,
      assetAmount: maybeNum,
      recipient: text(),
      paymentMethod: text(),
      receiptId: maybeText,
      chain: maybeText,
      explorerUrl: maybeText,
    }),
  ),
});
export type OperatePartnerPayments = z.output<typeof OperatePartnerPayments>;

const money = {
  events: num(0),
  gross: num(0),
  platformFee: num(0),
  net: num(0),
};

/**
 * Aomi's statement to the builder: one document with entries of both signs. Charges (the
 * `model` and `hosting` subjects) carry a negative net, earnings (`tool_invocation`,
 * `outcome`) a positive one. Amounts are raw USD floats; the UI formats them.
 */
export const OperateStatementResult = wire({
  ...scope,
  range: wire({ fromDate: text(), toDate: text() }),
  /** False when the ledger could not be read; true with no entries is an empty statement. */
  available: flag,
  summary: wire({
    grossRevenue: num(0),
    platformFees: num(0),
    serviceCharges: num(0),
    net: num(0),
  }),
  revenue: list(
    wire({ subject: text(), agent: text(), agentId: maybeNum, ...money }),
  ),
  charges: list(
    wire({
      item: text(),
      agent: text(),
      agentId: maybeNum,
      events: num(0),
      amount: num(0),
    }),
  ),
  entries: list(
    wire({ day: text(), agent: text(), subject: text(), ...money }),
  ),
  payments: OperatePartnerPayments,
});
export type OperateStatementResult = z.output<typeof OperateStatementResult>;

// ── Logs ──────────────────────────────────────────────────────────────────

/** The builder-owned key that funded a usage event, from its details; null for other events. */
const ModelKey = maybe(
  wire({ id: maybeNum, label: maybeText, prefix: maybeText }),
).transform((key) =>
  key && key.id !== null && Number.isFinite(key.id)
    ? { ...key, id: key.id }
    : null,
);

const log = {
  occurredAt: seconds,
  eventType: text(),
  id: text(),
  agent: text(),
  agentId: maybeNum,
  summary: text(),
  /** The event's own fields, as the manager sent them. */
  details: z.unknown().transform((value) => (isRecord(value) ? value : {})),
  modelKey: ModelKey,
  // The invocation-trace contract, null for plain control-plane events. Args and results are
  // operational payloads; user intents never ship.
  kind: oneOf(["invocation", "event"], null),
  status: oneOf(["ok", "error", "info"], null),
  tool: maybeText,
  durationMs: maybeNum,
  retries: maybeNum,
  threadId: maybeText,
  args: maybeText,
  result: maybeText,
};
const logAliases = { modelKey: ["details.model_key", "details.modelKey"] };

export const OperateLogEntry = wire(log, logAliases);
export type OperateLogEntry = z.output<typeof OperateLogEntry>;

export const OperateLogCursor = maybe(
  wire({ occurredAt: seconds, eventType: text(), id: text() }),
).transform((cursor) =>
  cursor?.occurredAt && cursor.eventType && cursor.id ? cursor : null,
);
export type OperateLogCursor = NonNullable<z.output<typeof OperateLogCursor>>;

/** Logs: one newest-first page; project-less agents and shared partner settlements carry a null `projectId`. */
export const UserLogsResult = wire({
  projects: list(UserProjectRef),
  logs: list(wire({ ...log, ...tagged }, logAliases)),
  nextCursor: OperateLogCursor,
  invocationsAvailable: z.unknown().transform((value) => value !== false),
});
export type UserLogsResult = z.output<typeof UserLogsResult>;
export type UserLogRow = UserLogsResult["logs"][number];

// ── Observability ─────────────────────────────────────────────────────────

const series = maybeList(z.unknown().transform(Number));

export const OperateAgentMetrics = wire({
  provider: text(),
  windowSeconds: num(0),
  available: flag,
  requestsPerMinute: maybeNum,
  /** Chat-request error rate; tool and tx failures are separate below. */
  errorRate: maybeNum,
  p95LatencyMs: maybeNum,
  inflightRequests: maybeNum,
  /** The 24h trend contract, oldest bucket first. */
  trendWindowSeconds: maybeNum,
  chats24h: maybeNum,
  toolCalls24h: maybeNum,
  transactions24h: maybeNum,
  /** Hourly counts over the trend window, oldest bucket first. */
  chatsHourly: series,
  toolCallsHourly: series,
  transactionsHourly: series,
  toolErrorRate: maybeNum,
  txErrorRate: maybeNum,
  coldStartMs: maybeNum,
});
export type OperateAgentMetrics = z.output<typeof OperateAgentMetrics>;

export const OperateAgentHealth = wire({
  agentId: num(0),
  agent: text(),
  /** `publisher/name`. */
  slug: text(),
  projectId: maybeNum,
  active: flag,
  loaded: flag,
  releaseTag: maybeText,
  sdkVersion: maybeText,
  status: text(),
  metrics: maybe(OperateAgentMetrics),
  pricing: maybe(AgentPricingSnapshot),
});
export type OperateAgentHealth = z.output<typeof OperateAgentHealth>;

export const OperateObservabilityResult = wire({
  ...scope,
  monitoring: maybe(
    wire({ provider: text(), status: text(), windowSeconds: num(0) }),
  ),
  agents: list(OperateAgentHealth),
  dashboardLinks: list(wire({ label: text(), url: text(), scope: text() })),
  platformMetrics: list(
    wire({
      label: text(),
      value: maybeNum,
      unit: text(),
      scope: text(),
      description: z
        .unknown()
        .transform((value) => (typeof value === "string" ? value : undefined)),
    }),
  ),
});
export type OperateObservabilityResult = z.output<
  typeof OperateObservabilityResult
>;

// ── One agent's detail ──────────────────────────────────────────────────────

/** Per-hour values where an hour without samples reads null. */
const sparseSeries = maybeList(
  z.unknown().transform((value) => {
    const numeric = value == null ? NaN : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }),
);

export const OperateAgentDetailResult = wire({
  archive: maybe(wire({
    releaseTag: maybeText,
    sdkVersion: maybeText,
    binaryBytes: maybeNum,
    deploys: list(wire({ id: num(), tag: text(), at: seconds, sdkVersion: maybeText })),
  })),
  project: maybe(Project),
  platform: maybeText,
  windowSeconds: num(0),
  agent: wire({
    agentId: num(0),
    name: text(),
    /** `publisher/name`. */
    slug: text(),
    releaseTag: maybeText,
    sdkVersion: maybeText,
    active: flag,
    loaded: flag,
    status: text(),
  }),
  funnel: wire({
    chats24h: maybeNum,
    toolCalls24h: maybeNum,
    txProposed24h: maybeNum,
    txSubmitted24h: maybeNum,
    txConfirmed24h: maybeNum,
    txReverted24h: maybeNum,
  }),
  activeUsers24h: maybeNum,
  credits: wire({
    credits24h: maybeNum,
    creditsPerTurn24h: maybeNum,
    creditsDaily: list(wire({ day: text(), credits: num(0) })),
  }),
  tools: list(
    wire({
      tool: text(),
      calls: maybeNum,
      errors: maybeNum,
      errorRate: maybeNum,
      p95Ms: maybeNum,
      lastError: maybe(wire({ message: maybeText, occurredAt: num(0) })),
    }),
  ),
  lifecycle: wire({
    coldStartMs: maybeNum,
    loads24h: maybeNum,
    evictions24h: maybeNum,
  }),
  hourly: wire({
    chats: series,
    toolCalls: series,
    /** Per-hour chat request P95 in milliseconds; null where an hour has no samples. */
    p95LatencyMs: sparseSeries,
    transactions: series,
  }),
});
export type OperateAgentDetailResult = z.output<
  typeof OperateAgentDetailResult
>;
