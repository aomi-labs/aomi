// Dense log viewer: one line per record, click to expand. Handles both
// record kinds — invocation traces (tool, args, result, duration) and
// control-plane events. The backend combines both record types on this
// surface. Privacy: user intents never reach it; args/results are operational
// payloads.

import { Lock, X } from "lucide-react";
import {
  clockLabel,
  creditsToUsd,
  dayLabel,
  truncateAddress,
  usdLabel,
} from "./format";

type LogRow = Record<string, any>;

export type LogsPageFilter = {
  app: string | null;
  tool: string | null;
  errorsOnly: boolean;
  paymentsOnly: boolean;
};

export const EMPTY_LOGS_PAGE_FILTER: LogsPageFilter = {
  app: null,
  tool: null,
  errorsOnly: false,
  paymentsOnly: false,
};

const SELECT_CLS =
  "border-border bg-surface text-foreground h-8 rounded-md border px-2 text-xs";

const DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  error: "bg-red-500",
  info: "bg-zinc-500",
};

function statusOf(row: LogRow): "ok" | "error" | "info" {
  if (row.status === "ok" || row.status === "error" || row.status === "info")
    return row.status;
  return /error|failed|revert/i.test(String(row.eventType ?? ""))
    ? "error"
    : "info";
}

function isInvocation(row: LogRow): boolean {
  return row.kind === "invocation" || (row.tool != null && row.args != null);
}

/** Payment rows are usage events the billing pipeline tags at `details.source`. */
type PaymentSource = "partner_fee" | "partner_settlement";

function paymentSource(row: LogRow): PaymentSource | null {
  const source = row.details?.source;
  return source === "partner_fee" || source === "partner_settlement"
    ? source
    : null;
}

function modelKeyLabel(row: LogRow): string | null {
  if (row.eventType !== "usage" || !row.modelKey) return null;
  const label =
    String(row.modelKey.label ?? "").trim() ||
    `Key #${String(row.modelKey.id)}`;
  const prefix = String(row.modelKey.prefix ?? "").trim();
  return prefix ? `${label} · ${prefix}…` : label;
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function ExpandedDetail({ row }: { row: LogRow }) {
  const status = statusOf(row);
  return (
    <div className="border-border bg-surface-subtle/60 grid gap-x-6 gap-y-2 border-t px-8 py-3 lg:grid-cols-2">
      <div>
        <div className="text-dim mb-1 text-[10px] uppercase tracking-wide">
          Arguments
        </div>
        <pre className="whitespace-pre-wrap font-mono text-xs leading-5">
          {pretty(String(row.args ?? ""))}
        </pre>
      </div>
      <div>
        <div className="text-dim mb-1 text-[10px] uppercase tracking-wide">
          {status === "error" ? "Error" : "Result"}
        </div>
        <pre
          className={`whitespace-pre-wrap font-mono text-xs leading-5 ${status === "error" ? "text-red-500" : ""}`}
        >
          {pretty(String(row.result ?? ""))}
        </pre>
      </div>
      <div className="text-dim text-xs lg:col-span-2">
        {row.retries ? `${row.retries} retries · ` : ""}
        {row.threadId ? `${row.threadId} · ` : ""}
        {row.application}
      </div>
    </div>
  );
}

function PaymentDetail({
  row,
  source,
}: {
  row: LogRow;
  source: PaymentSource;
}) {
  const details = row.details ?? {};
  const settled = source === "partner_settlement";
  const credits = Number(
    (settled ? details.paid_credits : details.credits_used) ?? 0,
  );
  const billingItems: LogRow[] = Array.isArray(details.billing?.items)
    ? details.billing.items
    : [];
  return (
    <div className="border-border bg-surface-subtle/60 grid gap-3 border-t px-8 py-3 text-xs sm:grid-cols-3">
      <div>
        <div className="text-dim text-[10px] uppercase tracking-wide">
          Amount
        </div>
        <div className="mt-1 font-mono">
          {credits.toFixed(2)} credits · {usdLabel(creditsToUsd(credits))}
        </div>
      </div>
      <div>
        <div className="text-dim text-[10px] uppercase tracking-wide">
          Beneficiary
        </div>
        <div className="mt-1 font-mono" title={String(details.recipient ?? "")}>
          {truncateAddress(details.recipient) || "—"}
        </div>
      </div>
      <div>
        <div className="text-dim text-[10px] uppercase tracking-wide">
          Settlement
        </div>
        <div
          className="mt-1 font-mono"
          title={String(details.receipt_id ?? "")}
        >
          {truncateAddress(details.receipt_id) ||
            (settled ? "—" : "awaiting recipient-bucket settlement")}
        </div>
      </div>
      {billingItems.length ? (
        <div className="sm:col-span-3">
          <div className="text-dim text-[10px] uppercase tracking-wide">
            Priced calls
          </div>
          <div className="divide-border mt-1 divide-y rounded-md border">
            {billingItems.map((item, index) => (
              <div
                key={`${String(item.tool ?? "priced-tool")}-${index}`}
                className="flex items-center justify-between gap-3 px-2 py-1.5"
              >
                <span className="truncate font-mono">
                  {item.tool ?? "Priced tool"}
                </span>
                <span className="text-dim shrink-0 font-mono">
                  {Number(item.credits ?? 0).toFixed(2)} credits
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function LogRows({
  rows,
  apps,
  tools,
  filter,
  onFilterChange,
  openId,
  onToggle,
}: {
  rows: LogRow[];
  apps: string[];
  tools: string[];
  filter: LogsPageFilter;
  onFilterChange: (next: LogsPageFilter) => void;
  openId: string | null;
  onToggle: (id: string | null) => void;
}) {
  const visible = rows.filter((row) => {
    if (filter.app && row.application !== filter.app) return false;
    if (filter.tool && (!isInvocation(row) || row.tool !== filter.tool))
      return false;
    if (filter.errorsOnly && statusOf(row) !== "error") return false;
    if (filter.paymentsOnly && !paymentSource(row)) return false;
    return true;
  });
  const active =
    filter.app || filter.tool || filter.errorsOnly || filter.paymentsOnly;

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="border-border bg-surface-subtle flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
        <select
          value={filter.app ?? ""}
          onChange={(event) =>
            onFilterChange({ ...filter, app: event.target.value || null })
          }
          className={SELECT_CLS}
        >
          <option value="">All apps</option>
          {apps.map((app) => (
            <option key={app} value={app}>
              {app}
            </option>
          ))}
        </select>
        {tools.length ? (
          <select
            value={filter.tool ?? ""}
            onChange={(event) =>
              onFilterChange({ ...filter, tool: event.target.value || null })
            }
            className={SELECT_CLS}
          >
            <option value="">All tools</option>
            {tools.map((tool) => (
              <option key={tool} value={tool}>
                {tool}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          onClick={() =>
            onFilterChange({ ...filter, errorsOnly: !filter.errorsOnly })
          }
          className={`rounded-full border px-2.5 py-1 text-xs ${
            filter.errorsOnly
              ? "border-red-500/30 bg-red-500/10 text-red-500"
              : "border-border bg-surface text-dim"
          }`}
        >
          Errors only
        </button>
        <button
          type="button"
          onClick={() =>
            onFilterChange({ ...filter, paymentsOnly: !filter.paymentsOnly })
          }
          className={`rounded-full border px-2.5 py-1 text-xs ${
            filter.paymentsOnly
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
              : "border-border bg-surface text-dim"
          }`}
        >
          Partner payments only
        </button>
        {active ? (
          <button
            type="button"
            onClick={() => onFilterChange(EMPTY_LOGS_PAGE_FILTER)}
            className="text-dim hover:text-foreground flex items-center gap-1 text-xs"
          >
            <X className="size-3" /> Clear filters
          </button>
        ) : null}
        <span className="text-dim ml-auto flex items-center gap-1.5 text-xs">
          <Lock className="size-3" />
          user messages and intents are never shown
        </span>
      </div>

      {/* Stream: one line per record */}
      <div className="border-border overflow-hidden rounded-md border">
        {visible.map((row, position) => {
          const rowId = `${row.eventType ?? "invocation"}-${row.id}`;
          const prev = position > 0 ? visible[position - 1] : null;
          const day = dayLabel(row.occurredAt);
          const showDay = !prev || dayLabel(prev.occurredAt) !== day;
          const payment = paymentSource(row);
          const expandable = isInvocation(row) || payment != null;
          const open = openId === rowId;
          const status = statusOf(row);
          const keyLabel = modelKeyLabel(row);
          return (
            <div key={rowId}>
              {showDay && day ? (
                <div className="border-border bg-surface-subtle text-dim border-b px-3 py-1 text-[10px] uppercase tracking-wide">
                  {day}
                </div>
              ) : null}
              <div
                onClick={
                  expandable ? () => onToggle(open ? null : rowId) : undefined
                }
                className={`border-border grid grid-cols-[8px_66px_150px_1fr] items-baseline gap-x-3 border-b px-3 py-1.5 font-mono text-xs last:border-b-0 sm:grid-cols-[8px_66px_150px_60px_1fr_110px] ${
                  expandable ? "hover:bg-surface-subtle cursor-pointer" : ""
                } ${open ? "bg-surface-subtle" : "bg-surface"}`}
              >
                <span
                  className={`size-2 self-center rounded-full ${DOT[status]}`}
                />
                <span className="text-dim">{clockLabel(row.occurredAt)}</span>
                <span className={expandable ? "text-foreground" : "text-dim"}>
                  {isInvocation(row)
                    ? row.tool
                    : payment === "partner_settlement"
                      ? "settlement confirmed"
                      : payment === "partner_fee"
                        ? "fee accrued"
                        : row.eventType}
                </span>
                <span className="text-dim hidden text-right sm:block">
                  {row.durationMs != null ? `${row.durationMs}ms` : ""}
                </span>
                <span
                  className={`flex min-w-0 items-center gap-2 ${
                    status === "error"
                      ? "text-red-500"
                      : expandable
                        ? "text-foreground"
                        : "text-dim"
                  }`}
                  title={String(row.summary ?? "")}
                >
                  <span className="min-w-0 truncate">
                    {row.retries ? `[retry ${row.retries}] ` : ""}
                    {row.summary}
                  </span>
                  {keyLabel ? (
                    <span
                      className="border-border bg-surface-subtle text-foreground shrink-0 rounded border px-1.5 py-0.5 font-sans text-[10px]"
                      title={`Funded by model key ${keyLabel}`}
                    >
                      {keyLabel}
                    </span>
                  ) : null}
                </span>
                <span className="text-dim hidden truncate text-right sm:block">
                  {row.application}
                </span>
              </div>
              {open ? (
                payment ? (
                  <PaymentDetail row={row} source={payment} />
                ) : (
                  <ExpandedDetail row={row} />
                )
              ) : null}
            </div>
          );
        })}
        {!visible.length ? (
          <div className="text-dim bg-surface py-8 text-center text-sm">
            No records match these filters.
          </div>
        ) : null}
      </div>
    </div>
  );
}
