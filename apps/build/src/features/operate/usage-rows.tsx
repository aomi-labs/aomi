"use client";

// Usage page: builder-facing revenue-share statement (gross / platform fee /
// net + charges) when the backend emits `statement`; falls back to the
// legacy token/credits meter until then. End-user spend stays in Chat billing.

import { UrlLink as Link } from "@/components/url-link";
import {
  signedUsdLabel,
  statementPeriodLabel,
  subjectLabel,
  tokensLabel,
  usdLabel,
} from "./format";
import { PartnerPayments } from "./partner-payments";
import { Card, TD, TH } from "./table";

type Row = Record<string, any>;

function Statement({
  statement,
  breakdown,
}: {
  statement: Row;
  breakdown: Row[];
}) {
  const summary = statement.summary;
  const revenue: Row[] = statement.revenue ?? [];
  const charges: Row[] = statement.charges ?? [];
  const entries: Row[] = statement.entries ?? [];
  const period = statementPeriodLabel(statement.range);
  return (
    <div className="space-y-4">
      <p className="text-dim text-xs leading-5">
        Revenue, platform fees, and charges for your apps in this statement
        period. End-user spend is reported separately under{" "}
        <Link
          href="/settings/billing"
          className="text-foreground hover:underline"
        >
          Account → Billing
        </Link>
        .
      </p>

      {summary ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[
            {
              label: "Gross revenue",
              value: usdLabel(summary.grossRevenue),
              sub: "collected from end users",
            },
            {
              label: "Platform fees",
              value: usdLabel(-Math.abs(summary.platformFees)),
              sub: "revenue share",
            },
            {
              label: "Service charges",
              value: usdLabel(-Math.abs(summary.serviceCharges)),
              sub: "model usage & hosting",
            },
            {
              label: "Net",
              value: signedUsdLabel(summary.net),
              sub: period,
              net: true,
            },
          ].map((tile) => (
            <div
              key={tile.label}
              className="border-border bg-surface rounded-md border px-3 py-2.5"
            >
              <div className="text-dim text-xs">{tile.label}</div>
              <div
                className={`text-lg font-semibold ${tile.net ? "text-emerald-500" : "text-foreground"}`}
              >
                {tile.value}
              </div>
              <div className="text-dim text-xs">{tile.sub}</div>
            </div>
          ))}
        </div>
      ) : null}

      {statement.payments ? (
        <PartnerPayments payments={statement.payments} period={period} />
      ) : null}

      <Card
        title="Revenue"
        right={
          period ? <span className="text-dim text-xs">{period}</span> : null
        }
      >
        <div className="overflow-x-auto">
          <table className="divide-border min-w-full divide-y text-sm">
            <thead className="bg-surface-subtle">
              <tr>
                <th className={TH}>Subject</th>
                <th className={TH}>App</th>
                <th className={TH}>Events</th>
                <th className={TH}>Gross</th>
                <th className={TH}>Platform fee</th>
                <th className={TH}>Net</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {revenue.map((row, i) => (
                <tr key={i} className={row.gross === 0 ? "text-dim" : ""}>
                  <td className={`${TD} font-medium`}>
                    {subjectLabel(row.subject)}
                  </td>
                  <td className={TD}>{row.application}</td>
                  <td className={`${TD} text-xs`}>{row.events}</td>
                  <td className={`${TD} font-mono text-xs`}>
                    {usdLabel(row.gross)}
                  </td>
                  <td className={`${TD} font-mono text-xs`}>
                    {usdLabel(row.platformFee)}
                  </td>
                  <td className={`${TD} font-mono text-xs font-semibold`}>
                    {usdLabel(row.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-2 lg:grid-cols-[1fr_360px]">
        <Card title="Charges">
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-surface-subtle">
                <tr>
                  <th className={TH}>Item</th>
                  <th className={TH}>App</th>
                  <th className={TH}>Events</th>
                  <th className={TH}>Amount</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {charges.map((row, i) => (
                  <tr key={i}>
                    <td className={TD}>{subjectLabel(row.item)}</td>
                    <td className={TD}>{row.application}</td>
                    <td className={`${TD} text-dim text-xs`}>{row.events}</td>
                    <td className={`${TD} font-mono text-xs`}>
                      {usdLabel(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Model usage detail"
          right={<span className="text-dim text-xs">by provider/model</span>}
        >
          <div className="px-3 py-2">
            <div className="space-y-2">
              {breakdown.map((row, index) => (
                <div
                  key={`${row.provider}-${row.model}-${index}`}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 truncate font-mono text-xs">
                    {row.provider}/{row.model}
                  </span>
                  <span className="text-dim font-mono text-xs">
                    {Number(row.creditsUsed ?? 0).toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-dim mt-2 text-xs leading-4">
              Token-level usage explains the base cost. Apps using
              customer-provided keys (BYOK) incur no model charges.
            </p>
          </div>
        </Card>
      </div>

      <Card title="Entries">
        <div className="overflow-x-auto">
          <table className="divide-border min-w-full divide-y text-sm">
            <thead className="bg-surface-subtle">
              <tr>
                <th className={TH}>Day</th>
                <th className={TH}>App</th>
                <th className={TH}>Subject</th>
                <th className={TH}>Events</th>
                <th className={TH}>Gross</th>
                <th className={TH}>Platform fee</th>
                <th className={TH}>Net</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {entries.map((row, i) => (
                <tr key={i}>
                  <td className={`${TD} text-dim whitespace-nowrap`}>
                    {row.day}
                  </td>
                  <td className={TD}>{row.application}</td>
                  <td className={`${TD} text-xs`}>
                    {subjectLabel(row.subject)}
                  </td>
                  <td className={`${TD} text-xs`}>{row.events}</td>
                  <td className={`${TD} font-mono text-xs`}>
                    {usdLabel(row.gross)}
                  </td>
                  <td className={`${TD} font-mono text-xs`}>
                    {usdLabel(row.platformFee)}
                  </td>
                  <td className={`${TD} font-mono text-xs font-semibold`}>
                    {signedUsdLabel(row.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/** Legacy token/credits meter — shown until statement billing ships. */
function Meter({ daily, breakdown }: { daily: Row[]; breakdown: Row[] }) {
  return (
    <div className="space-y-3">
      <p className="text-dim text-xs leading-5">
        Model and token credits by app and day.{" "}
        <Link
          href="/settings/billing"
          className="text-foreground hover:underline"
        >
          Account → Billing
        </Link>{" "}
        covers payment setup in Chat.
      </p>
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="divide-border min-w-full divide-y text-sm">
            <thead className="bg-surface-subtle text-dim text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Day</th>
                <th className="px-3 py-2">App</th>
                <th className="px-3 py-2">Input</th>
                <th className="px-3 py-2">Output</th>
                <th className="px-3 py-2">Credits</th>
              </tr>
            </thead>
            <tbody className="divide-border bg-surface divide-y">
              {daily.map((row, index) => (
                <tr
                  key={`${row.project?.id}-${row.periodUtcDay}-${row.application}-${index}`}
                >
                  <td className="px-3 py-2">{row.periodUtcDay}</td>
                  <td className="px-3 py-2">{row.application}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {tokensLabel(row.inputTokens)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {tokensLabel(row.outputTokens)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {Number(row.creditsUsed ?? 0).toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-border bg-surface rounded-md border p-3">
          <div className="text-dim mb-2 text-xs uppercase">Breakdown</div>
          <div className="space-y-2">
            {breakdown.map((row, index) => (
              <div
                key={`${row.project?.id}-${row.provider}-${row.model}-${index}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="min-w-0 truncate">
                  {row.provider}/{row.model}
                </span>
                <span className="text-dim">
                  {Number(row.creditsUsed ?? 0).toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function UsageRows({ payload }: { payload: Row }) {
  const daily: Row[] = payload.daily ?? [];
  const breakdown: Row[] = payload.breakdown ?? [];
  if (payload.statement) {
    return <Statement statement={payload.statement} breakdown={breakdown} />;
  }
  return <Meter daily={daily} breakdown={breakdown} />;
}
