"use client";

// Per-app drill-down dashboard shared by the live product route and the fixture
// design harness. Product data is rendered as received; empty series are an
// honest no-data state rather than substituted example values.

import { ArrowLeft, ExternalLink } from "lucide-react";
import type { AppFixture, TxRecord } from "@/features/operate/fixtures";

const HOUR_LABELS = ["00:00", "06:00", "12:00", "18:00", "23:00"];

function BarChart({
  series,
  height = 96,
}: {
  series: Array<{ values: number[]; className: string }>;
  height?: number;
}) {
  if (!series.some((item) => item.values.length)) {
    return (
      <div
        className="text-dim flex items-center justify-center text-xs"
        style={{ height }}
      >
        No data in this window.
      </div>
    );
  }
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  const n = Math.max(...series.map((s) => s.values.length), 1);
  const band = 100 / n;
  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      aria-hidden
    >
      {series.map((s, si) => {
        const w = (band * 0.7) / series.length;
        return s.values.map((v, i) => {
          const h = (v / max) * (height - 8);
          return (
            <rect
              key={`${si}-${i}`}
              x={i * band + band * 0.15 + si * w}
              y={height - h}
              width={w}
              height={h}
              className={s.className}
              rx={0.4}
            />
          );
        });
      })}
    </svg>
  );
}

function LineChart({
  values,
  height = 96,
}: {
  values: Array<number | null>;
  height?: number;
}) {
  const samples = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (!samples.length) {
    return (
      <div
        className="text-dim flex items-center justify-center text-xs"
        style={{ height }}
      >
        No data in this window.
      </div>
    );
  }
  const max = Math.max(...samples, 1);
  const point = (value: number, index: number) => {
    const x = values.length > 1 ? (index / (values.length - 1)) * 100 : 50;
    const y = height - 6 - (value / max) * (height - 14);
    return { x, y };
  };
  const segments = values.reduce<Array<Array<{ x: number; y: number }>>>(
    (all, value, index) => {
      if (value === null || !Number.isFinite(value)) {
        all.push([]);
      } else {
        all[all.length - 1]?.push(point(value, index));
      }
      return all;
    },
    [[]],
  );
  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className="text-dim w-full"
      style={{ height }}
      aria-hidden
    >
      {segments.map((segment, index) =>
        segment.length > 1 ? (
          <polyline
            key={index}
            points={segment.map(({ x, y }) => `${x},${y}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        ) : segment.length === 1 ? (
          <line
            key={index}
            x1={segment[0]?.x}
            y1={segment[0]?.y}
            x2={segment[0]?.x}
            y2={segment[0]?.y}
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null,
      )}
    </svg>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "bad" | "warn";
}) {
  return (
    <div className="border-border bg-surface rounded-md border px-3 py-2.5">
      <div className="text-dim text-xs">{label}</div>
      <div
        className={`text-lg font-semibold ${tone === "bad" ? "text-red-500" : tone === "warn" ? "text-amber-500" : "text-foreground"}`}
      >
        {value}
      </div>
      {sub ? <div className="text-dim text-xs">{sub}</div> : null}
    </div>
  );
}

function Panel({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border bg-surface rounded-md border">
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <span className="text-dim text-xs font-medium uppercase">{title}</span>
        {right}
      </div>
      <div className="px-3 py-3">{children}</div>
    </div>
  );
}

const STATUS_CHIP: Record<TxRecord["status"], string> = {
  confirmed: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  submitted: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  failed: "bg-red-500/10 text-red-500 border-red-500/30",
  created: "bg-surface-subtle text-dim border-border",
};

const STATUS_DOT: Record<string, string> = {
  healthy: "bg-emerald-500",
  not_loaded: "bg-amber-500",
  inactive: "bg-zinc-400",
};

function clockOf(tx: TxRecord): string {
  // Live rows carry ISO timestamps; fixture rows carry locale strings
  // ("7/15/2026, 5:47:58 PM"). Render a short clock for both.
  if (tx.time.includes("T")) return `${tx.time.slice(11, 16)} UTC`;
  const clock = tx.time.split(", ")[1] ?? tx.time;
  return clock.replace(/(\d+:\d+):\d+ (AM|PM)/, "$1 $2");
}

export function AppDetailView({
  app,
  displayName,
  example = false,
  dashboardHref,
  onBack,
  onOpenTrace,
  onOpenTx,
}: {
  app: AppFixture;
  displayName?: string;
  example?: boolean;
  dashboardHref?: string | null;
  onBack: () => void;
  onOpenTrace: (tool: string) => void;
  onOpenTx: (txId: string) => void;
}) {
  const { meta, detail } = app;
  const recentTx = app.transactions.slice(0, 4);
  const recentEvents = app.logs
    .filter((log) => log.kind === "event")
    .slice(0, 4);
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Back to observability"
            onClick={onBack}
            className="border-border bg-surface hover:bg-accent-hover rounded-md border p-2"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-normal tracking-tight">
                {displayName ?? meta.name}
              </h1>
              {example ? (
                <span
                  title="Live data for this view isn't connected yet — showing example data."
                  className="border-border bg-surface-subtle text-dim rounded-full border px-2 py-0.5 text-xs"
                >
                  Example data
                </span>
              ) : null}
              <span className="flex items-center gap-1.5 text-xs">
                <span
                  className={`size-2 rounded-full ${STATUS_DOT[meta.status] ?? "bg-zinc-400"}`}
                />{" "}
                {meta.status}
              </span>
              {meta.families.map((family) => (
                <span
                  key={family}
                  className="border-border bg-surface-subtle text-dim rounded-full border px-2 py-0.5 text-[10px] uppercase"
                >
                  {family}
                </span>
              ))}
            </div>
            <div className="text-dim text-xs">
              {meta.releaseTag ?? "No release"} · SDK {meta.sdkVersion ?? "—"} ·{" "}
              {meta.repo}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="border-border bg-surface flex rounded-md border text-xs">
            {["1h", "24h", "7d", "30d"].map((r) => (
              <button
                key={r}
                type="button"
                className={`px-3 py-1.5 ${r === "24h" ? "bg-accent-hover text-foreground rounded-md" : "text-dim"}`}
              >
                {r}
              </button>
            ))}
          </div>
          {dashboardHref ? (
            <a
              href={dashboardHref}
              target="_blank"
              rel="noreferrer"
              className="border-border bg-surface hover:bg-accent-hover flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs"
            >
              Grafana <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      </div>

      {/* Funnel */}
      <Panel title="Conversion funnel · 24h">
        <div className="flex flex-wrap items-stretch gap-0">
          {detail.funnel.map((stage, i) => {
            const prev = i > 0 ? detail.funnel[i - 1].value : null;
            const conv =
              prev && stage.value !== null
                ? Math.round((stage.value / prev) * 100)
                : null;
            return (
              <div key={stage.label} className="flex items-center">
                {i > 0 ? (
                  <div className="text-dim px-3 text-center text-xs">
                    <div>→</div>
                    <div>{prev ? `${conv}%` : "—"}</div>
                  </div>
                ) : null}
                <div className="border-border bg-surface-subtle min-w-28 rounded-md border px-4 py-3 text-center">
                  <div className="text-2xl font-semibold">
                    {stage.value ?? "—"}
                  </div>
                  <div className="text-dim text-xs">{stage.label}</div>
                </div>
              </div>
            );
          })}
          <div className="text-dim ml-auto flex flex-col justify-center pl-4 text-xs">
            {detail.funnelNote.map((note) => (
              <div key={note}>{note}</div>
            ))}
          </div>
        </div>
      </Panel>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {detail.kpis.map((kpi) => (
          <Tile
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            sub={kpi.sub}
            tone={kpi.tone}
          />
        ))}
      </div>

      {/* Charts */}
      <div className="grid gap-2 lg:grid-cols-3">
        <Panel
          title="Activity by hour"
          right={
            <span className="text-dim flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-sm bg-emerald-500/80" /> chats
              </span>
              <span className="flex items-center gap-1">
                <span className="bg-foreground/30 size-2 rounded-sm" /> tool
                calls
              </span>
            </span>
          }
        >
          <BarChart
            series={[
              {
                values: detail.toolCallsHourly,
                className: "fill-foreground/25",
              },
              { values: detail.chatsHourly, className: "fill-emerald-500/80" },
            ]}
          />
          <div className="text-dim mt-1 flex justify-between text-[10px]">
            {HOUR_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </Panel>
        <Panel
          title="P95 turn latency"
          right={<span className="text-dim text-xs">seconds</span>}
        >
          <LineChart values={detail.p95Hourly} />
          <div className="text-dim mt-1 flex justify-between text-[10px]">
            <span>00:00</span>
            <span>
              peak{" "}
              {detail.p95Hourly.some(
                (value) => value !== null && Number.isFinite(value),
              )
                ? `${Math.max(
                    ...detail.p95Hourly.filter(
                      (value): value is number =>
                        value !== null && Number.isFinite(value),
                    ),
                  ).toFixed(1)} s`
                : "—"}
            </span>
            <span>23:00</span>
          </div>
        </Panel>
        <Panel
          title="Credits per day"
          right={
            <span className="text-dim text-xs">7d · from usage ledger</span>
          }
        >
          <BarChart
            series={[
              {
                values: detail.creditsDaily.values,
                className: "fill-amber-500/70",
              },
            ]}
          />
          <div className="text-dim mt-1 flex justify-between text-[10px]">
            <span>{detail.creditsDaily.days[0] ?? "—"}</span>
            <span>
              {detail.creditsDaily.days.at(-1) ?? "—"} ·{" "}
              {detail.creditsDaily.values.at(-1) ?? "—"}
            </span>
          </div>
        </Panel>
      </div>

      {/* Tools table → click a row to open its trace in Logs */}
      <Panel
        title="Tools · 24h"
        right={
          <span className="text-dim text-xs">
            {detail.toolsSummary} · click a row to open its trace in Logs
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-dim text-left text-xs uppercase">
              <tr>
                <th className="py-1.5 pr-3">Tool</th>
                <th className="py-1.5 pr-3">Calls</th>
                <th className="py-1.5 pr-3">Errors</th>
                <th className="py-1.5 pr-3">Error rate</th>
                <th className="py-1.5 pr-3">P95</th>
                <th className="py-1.5">Last error</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {detail.tools.length ? (
                detail.tools.map((row) => (
                  <tr
                    key={row.tool}
                    onClick={() => onOpenTrace(row.tool)}
                    className="hover:bg-surface-subtle cursor-pointer"
                  >
                    <td className="py-2 pr-3 font-mono text-xs">{row.tool}</td>
                    <td className="py-2 pr-3">{row.calls ?? "—"}</td>
                    <td className="py-2 pr-3">{row.errors ?? "—"}</td>
                    <td
                      className={`py-2 pr-3 font-medium ${row.bad ? "text-red-500" : ""}`}
                    >
                      {row.errorRate}
                    </td>
                    <td className="py-2 pr-3">{row.p95}</td>
                    <td className="text-dim py-2 text-xs">{row.last}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="text-dim py-6 text-center text-sm">
                    No tool calls in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Transactions + right column */}
      <div className="grid gap-2 lg:grid-cols-[1fr_340px]">
        <Panel
          title="Recent transactions"
          right={
            <span className="text-dim text-xs">
              {detail.fees24h} · click a row to open it in Transactions
            </span>
          }
        >
          {recentTx.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-dim text-left text-xs uppercase">
                  <tr>
                    <th className="py-1.5 pr-3">Time</th>
                    <th className="py-1.5 pr-3">Action</th>
                    <th className="py-1.5 pr-3">Chain</th>
                    <th className="py-1.5 pr-3">Status</th>
                    <th className="py-1.5 pr-3">Fee</th>
                    <th className="py-1.5">Platform fee</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {recentTx.map((tx) => (
                    <tr
                      key={tx.id}
                      onClick={() => onOpenTx(tx.id)}
                      className="hover:bg-surface-subtle cursor-pointer"
                    >
                      <td className="text-dim py-2 pr-3 text-xs">
                        {clockOf(tx)}
                      </td>
                      <td className="max-w-64 truncate py-2 pr-3">
                        {tx.description}
                      </td>
                      <td className="py-2 pr-3">{tx.chain}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_CHIP[tx.status]}`}
                        >
                          {tx.status}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {tx.txFee ?? "—"}
                      </td>
                      <td className="py-2 font-mono text-xs">
                        {tx.platformFee ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-dim py-6 text-center text-sm">
              No transactions — read-only app.
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-2">
          <Panel title="Lifecycle">
            <dl className="space-y-1.5 text-sm">
              {detail.lifecycle.map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-dim">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title="Releases">
            <div className="space-y-2 text-sm">
              {detail.releases.length ? (
                detail.releases.map((release) => (
                  <div
                    key={release.tag}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="min-w-0 truncate font-mono text-xs">
                      {release.tag}
                    </span>
                    <span className="text-dim text-xs">{release.when}</span>
                    {release.current ? (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-500">
                        current
                      </span>
                    ) : (
                      <span className="text-dim text-xs">{release.note}</span>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-dim py-2 text-center text-sm">
                  No release history.
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>

      {/* Events */}
      <Panel
        title="Recent events"
        right={
          <span className="text-dim text-xs">
            app-filtered · full stream in Logs
          </span>
        }
      >
        <div className="space-y-2">
          {recentEvents.length ? (
            recentEvents.map((entry) => (
              <div
                key={`${entry.at}-${entry.eventType}`}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span
                  className={`min-w-0 truncate ${entry.status === "error" ? "text-red-500" : ""}`}
                >
                  {entry.summary}
                </span>
                <span className="text-dim shrink-0 text-xs">
                  {entry.eventType} · {entry.at}
                </span>
              </div>
            ))
          ) : (
            <div className="text-dim py-4 text-center text-sm">
              No recent events.
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
