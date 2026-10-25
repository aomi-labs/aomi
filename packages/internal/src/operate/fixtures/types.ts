// Fixture shapes for the Operate design mocks. One AppFixture hydrates every
// page (observability card, drill-down, transactions, logs, usage) for one
// app, as if it were real backend data. Privacy ruling is enforced at the
// data level: no user intents/messages exist anywhere in these shapes.

export type ChainFamily = "evm" | "svm";

export type TxStatus = "confirmed" | "submitted" | "failed" | "created";

export type TxRecord = {
  id: string;
  family: ChainFamily;
  /** epoch seconds, for cross-app merge ordering */
  ts: number;
  time: string;
  app: string;
  status: TxStatus;
  chain: string;
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  value: string;
  valueUsd?: string;
  description: string;
  /** EVM tx hash or SVM signature */
  hash?: string;
  // receipt — EVM
  block?: string;
  confirmations?: number;
  gasUsed?: string;
  gasLimit?: string;
  gasPct?: string;
  effGasPrice?: string;
  nonce?: number;
  // receipt — SVM
  slot?: string;
  computeUnits?: string;
  computeLimit?: string;
  priorityFee?: string;
  // both
  txFee?: string;
  platformFee?: string;
  method?: string;
  calldata?: string;
  transfers?: string[];
  revertReason?: string;
  thread: string;
  externalTxId: string;
  explorer?: string;
};

export type LogRecord = {
  /** epoch seconds, for cross-app merge ordering */
  ts: number;
  day: string;
  at: string;
  app: string;
  kind: "invocation" | "event";
  status: "ok" | "error" | "info";
  /** one-line scan summary (stands in for the SDK per-tool summarize hint) */
  summary: string;
  tool?: string;
  durationMs?: number;
  thread?: string;
  retries?: number;
  args?: string;
  result?: string;
  eventType?: string;
};

export type ToolStat = {
  tool: string;
  calls: number | null;
  errors: number | null;
  errorRate: string;
  p95: string;
  last: string;
  bad?: boolean;
};

/** Mirrors the extended OperateAppMetrics trend contract. */
export type AppCard = {
  requestsPerMinute: number | null;
  errorRate: number | null;
  p95LatencyMs: number | null;
  inflightRequests: number | null;
  chats24h: number | null;
  toolCalls24h: number | null;
  transactions24h: number | null;
  chatsHourly: number[] | null;
  toolCallsHourly: number[] | null;
  transactionsHourly: number[] | null;
  toolErrorRate: number | null;
  txErrorRate: number | null;
  coldStartMs: number | null;
  dylibBytes: number | null;
};

export type AppDetail = {
  funnel: Array<{ label: string; value: number | null }>;
  funnelNote: string[];
  kpis: Array<{
    label: string;
    value: string;
    sub?: string;
    tone?: "bad" | "warn";
  }>;
  chatsHourly: number[];
  toolCallsHourly: number[];
  p95Hourly: Array<number | null>;
  creditsDaily: { days: string[]; values: number[] };
  tools: ToolStat[];
  toolsSummary: string;
  fees24h: string;
  lifecycle: Array<[string, string]>;
  releases: Array<{
    tag: string;
    when: string;
    current: boolean;
    note: string;
  }>;
};

/** Mirrors the manager's statement wire (subjects, raw USD floats). */
export type StatementRows = {
  revenue: Array<{
    subject: string;
    events: number;
    gross: number;
    platformFee: number;
    net: number;
  }>;
  charges: Array<{
    item: string;
    events: number;
    amount: number;
  }>;
  entries: Array<{
    day: string;
    subject: string;
    events: number;
    gross: number;
    platformFee: number;
    net: number;
  }>;
};

export type AppFixture = {
  meta: {
    name: string;
    applicationId: number;
    families: ChainFamily[];
    releaseTag: string | null;
    sdkVersion: string | null;
    status: "healthy" | "not_loaded" | "inactive";
    repo: string;
  };
  card: AppCard;
  detail: AppDetail;
  transactions: TxRecord[];
  logs: LogRecord[];
  statement: StatementRows;
};
