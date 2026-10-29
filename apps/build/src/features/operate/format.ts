// Shared formatting helpers for the Operate pages.
import { shortAddress } from "@aomi-labs/client";
import { CHAIN_NAMES, caipChainId } from "@aomi-labs/internal/operate-format";

export function secondsLabel(value: unknown) {
  const n = Number(value ?? 0);
  return n > 0 ? new Date(n * 1000).toLocaleString() : "";
}

export function clockLabel(value: unknown) {
  const n = Number(value ?? 0);
  return n > 0
    ? new Date(n * 1000).toLocaleTimeString([], { hour12: false })
    : "";
}

export function dayLabel(value: unknown) {
  const n = Number(value ?? 0);
  return n > 0
    ? new Date(n * 1000).toLocaleDateString([], {
        month: "short",
        day: "numeric",
      })
    : "";
}

/** Shortens a loosely typed row value (address, hash, receipt id) for a table cell. */
export function truncateAddress(value: unknown): string {
  return shortAddress(String(value ?? "").trim());
}

export function valueLabel(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "0") return "—";
  return raw;
}

export function numberLabel(value: unknown, digits = 1) {
  if (value === null || value === undefined || value === "") return "No data";
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "No data";
}

export function percentLabel(value: unknown) {
  if (value === null || value === undefined || value === "") return "No data";
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "No data";
}

export function unitLabel(value: unknown, unit: string, digits = 1) {
  const label = numberLabel(value, digits);
  return label === "No data" ? label : `${label} ${unit}`;
}

export function countLabel(value: unknown) {
  if (value === null || value === undefined || value === "") return "No data";
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : "No data";
}

export function tokensLabel(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString() : String(value ?? "");
}

/** "$12.34" / "−$12.34" for the statement's raw USD floats. */
export function usdLabel(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toFixed(2);
  return n < 0 ? `−$${abs}` : `$${abs}`;
}

/** Signed variant for net amounts: "+$12.34" / "−$12.34". */
export function signedUsdLabel(value: unknown): string {
  const label = usdLabel(value);
  return label.startsWith("−") || label === "—" ? label : `+${label}`;
}

export {
  CREDITS_PER_USD,
  caipChainId,
  caipChainLabel,
  creditsToUsd,
} from "@aomi-labs/internal/operate-format";

/** "1 receipt" / "2 receipts" — counts in this UI are always small. */
export function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

// Statement subjects are DB slugs; the page speaks billing vocabulary.
const SUBJECT_LABELS: Record<string, string> = {
  tool_invocation: "Tool invocations",
  outcome: "Outcome fees",
  model: "Model usage",
  hosting: "App hosting",
};

export function subjectLabel(subject: unknown): string {
  const raw = String(subject ?? "");
  return SUBJECT_LABELS[raw] ?? raw;
}

/** "Jul 1 – Jul 15" from the statement's UTC calendar-day range. */
export function statementPeriodLabel(
  range:
    | {
        fromDate?: string;
        toDate?: string;
      }
    | null
    | undefined,
): string {
  const day = (value: string | undefined): string => {
    const parsed = Date.parse(`${value ?? ""}T00:00:00Z`);
    if (!Number.isFinite(parsed)) return value ?? "";
    return new Date(parsed).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };
  if (!range?.fromDate && !range?.toDate) return "";
  return `${day(range?.fromDate)} – ${day(range?.toDate)}`;
}

export function bytesLabel(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}


/** Backend-provided chain_name wins; otherwise map known ids, SVM → Solana. */
export function chainLabel(row: {
  chainName?: string | null;
  chainId?: number;
  family?: string | null;
}) {
  if (row.chainName) return row.chainName;
  if (row.family === "svm") return "Solana";
  const id = Number(row.chainId ?? 0);
  return CHAIN_NAMES[id] ?? (id ? String(id) : "—");
}
