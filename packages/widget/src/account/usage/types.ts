/**
 * Shared per-agent usage statement view model.
 */

/** Static account details used by the first-party theme-audit fixture. */
export interface UsageAccount {
  userId: string;
  handle: string;
  authType: string;
  address: string;
  network: string;
  tier: string;
  status: string;
  byok: boolean;
  verifiedEmail: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface UsagePeriod {
  periodLabel: string;
  from: string;
  to: string;
  issued: string;
}

export interface UsageSummaryTotals {
  modelUsd: number;
  toolUsd: number;
  outcomeUsd: number;
  computeUsd: number;
  onchainUsd: number;
  totalUsd: number;
  managedMarkupUsd: number;
}

export interface UsageAllowance {
  included: number;
  used: number;
}

export interface UsagePayment {
  settledVia: string;
  allowanceCredits: UsageAllowance;
  allowanceAppliedUsd: number;
  creditBankAppliedUsd: number;
  onchainUsd: number;
  onchainNote: string;
}

/** `agents[].settings.modelKey` — how the agent's model calls are billed. */
export type AgentModelKey = "managed" | "byok";

export interface AgentSettings {
  modelKey: AgentModelKey;
  agentByok: boolean;
  managedMarkupPct: number;
  note: string;
}

/** One model line within an agent's Section A group (`agents[].model.byModel[]`). */
export interface AgentModelRow {
  model: string;
  /** Live statement dimensions; optional in static design fixtures. */
  provider?: string;
  paymentMethod?: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  baseUsd: number;
  chargedUsd: number;
  /** Present on BYOK model rows: "paid by {agent}'s own key". */
  note?: string;
}

export interface AgentModelUsage {
  baseUsd: number;
  markupPct: number;
  markupUsd: number;
  chargedUsd: number;
  /** false only for a BYOK agent's model spend (Aomi doesn't bill it). */
  billed?: boolean;
  turns: number;
  byModel: AgentModelRow[];
}

export interface AgentToolItem {
  tool: string;
  calls: number;
  unitCredits: number;
  usd: number;
}

export interface AgentToolUsage {
  chargedUsd: number;
  calls: number;
  items: AgentToolItem[];
}

export interface AgentOutcomeItem {
  date: string;
  action: string;
  chain: string;
  flow: string;
  bps: number;
  feeToken: string;
  usd: number;
  tx: string;
}

export interface AgentOutcomeUsage {
  chargedUsd: number;
  txns: number;
  items: AgentOutcomeItem[];
}

/** One row of `agents[]` — everything one agent charged the user this period. */
export interface AgentUsageEntry {
  id: string;
  name: string;
  native: boolean;
  settings: AgentSettings;
  model: AgentModelUsage;
  /** null when the agent has no tool calls this period. */
  tool: AgentToolUsage | null;
  /** null when the agent has no on-chain outcomes this period. */
  outcome: AgentOutcomeUsage | null;
  agentTotalUsd: number;
}

/** One row of the by-agent matrix. `null` = subject not charged by this agent. */
export interface ByAgentRow {
  agent: string;
  modelUsd: number;
  toolUsd: number | null;
  outcomeUsd: number | null;
  totalUsd: number;
}

export interface UsageColumnTotals {
  modelUsd: number;
  toolUsd: number;
  outcomeUsd: number;
  totalUsd: number;
}

/** One calendar month of the statement — everything pre-rolled per month. */
export interface MonthlyStatement {
  period: UsagePeriod;
  summary: UsageSummaryTotals;
  payment: UsagePayment;
  agents: AgentUsageEntry[];
  byAgent: ByAgentRow[];
  columnTotals: UsageColumnTotals;
}

/** Full statement fixture used by the first-party theme-audit surface. */
export interface UsageFixtureData {
  account: UsageAccount;
  /** Newest month first. */
  months: MonthlyStatement[];
}
