/**
 * Per-app usage statement types — ported from the design mock.
 * The fixture (./fixture.ts) is stub data; see docs/SETTINGS-REDESIGN-GAPS.md.
 */

/**
 * Rich per-app usage fixture (mirrors `user-fixture.json` at the repo root).
 * A user is charged on three subjects — model, tool use, outcome — each
 * attributed to the app it ran under. The flat `usage` block above
 * (`UsageStatement`) is a drop-in-compatible rollup of the same data.
 */
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

/** `apps[].settings.modelKey` — how the app's model calls are billed. */
export type AppModelKey = "managed" | "byok";

export interface AppSettings {
  modelKey: AppModelKey;
  appByok: boolean;
  managedMarkupPct: number;
  note: string;
}

/** One model line within an app's Section A group (`apps[].model.byModel[]`). */
export interface AppModelRow {
  model: string;
  /** Live statement dimensions; optional only for legacy design fixtures. */
  provider?: string;
  paymentMethod?: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  baseUsd: number;
  chargedUsd: number;
  /** Present on BYOK model rows: "paid by {app}'s own key". */
  note?: string;
}

export interface AppModelUsage {
  baseUsd: number;
  markupPct: number;
  markupUsd: number;
  chargedUsd: number;
  /** false only for a BYOK app's model spend (Aomi doesn't bill it). */
  billed?: boolean;
  turns: number;
  byModel: AppModelRow[];
}

export interface AppToolItem {
  tool: string;
  calls: number;
  unitCredits: number;
  usd: number;
}

export interface AppToolUsage {
  chargedUsd: number;
  calls: number;
  items: AppToolItem[];
}

export interface AppOutcomeItem {
  date: string;
  action: string;
  chain: string;
  flow: string;
  bps: number;
  feeToken: string;
  usd: number;
  tx: string;
}

export interface AppOutcomeUsage {
  chargedUsd: number;
  txns: number;
  items: AppOutcomeItem[];
}

/** One row of `apps[]` — everything one app charged the user this period. */
export interface AppUsageEntry {
  id: string;
  name: string;
  native: boolean;
  settings: AppSettings;
  model: AppModelUsage;
  /** null when the app has no tool calls this period. */
  tool: AppToolUsage | null;
  /** null when the app has no on-chain outcomes this period. */
  outcome: AppOutcomeUsage | null;
  appTotalUsd: number;
}

/** One row of the by-app matrix. `null` = subject not charged by this app. */
export interface ByAppRow {
  app: string;
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
  apps: AppUsageEntry[];
  byApp: ByAppRow[];
  columnTotals: UsageColumnTotals;
}

/** The full statement fixture shape — matches `user-fixture.json` 1:1. */
export interface UsageFixtureData {
  account: UsageAccount;
  /** Newest month first. */
  months: MonthlyStatement[];
}
