"use client";

import type { Project } from "@aomi-labs/deploy";
import {
  Activity,
  Gauge,
  ListFilter,
  ScrollText,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ControlPlaneLink } from "@/components/control-plane/control-plane-link";
import { useGitHubSession } from "@/components/control-plane/github-session-context";
import {
  GitHubSignInPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";
import {
  buildQueryKeys,
  buildQueryStaleTime,
  githubAccountKey,
} from "@/features/deploy/query-keys";
import { operateFetch, operatePaymentsFetch, type OperateKind } from "./client";
import {
  bytesLabel,
  countLabel,
  numberLabel,
  percentLabel,
  unitLabel,
  usdLabel,
} from "./format";
import { TransactionRows } from "./tx-rows";
import {
  EMPTY_LOGS_PAGE_FILTER,
  LogRows,
  type LogsPageFilter,
} from "./log-rows";
import { UsageRows } from "./usage-rows";

// OperateView renders every operate surface except Bots, which has its own
// dedicated BotsView (register form + table) instead of the generic
// kind-indexed rows below.
export type ViewKind = Exclude<OperateKind, "bots">;

type Projectish = Project & { apps?: unknown[] };

type OperatePayload = {
  /** True when the BFF filled gaps with example fixture data (BE not live yet). */
  example?: boolean;
  projects?: Projectish[];
  transactions?: Array<Record<string, any>>;
  daily?: Array<Record<string, any>>;
  breakdown?: Array<Record<string, any>>;
  statement?: Record<string, any> | null;
  logs?: Array<Record<string, any>>;
  apps?: Array<Record<string, any>>;
  dashboardLinks?: Array<Record<string, any>>;
  monitoring?: Record<string, any> | null;
  platformMetrics?: Array<Record<string, any>>;
  payments?: Record<string, any> | null;
  nextCursor?: unknown | null;
};

type PaymentPayload = {
  payments?: Record<string, any> | null;
};

type PaymentState = {
  payments: Record<string, any> | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
};

const meta = {
  transactions: { title: "Transactions", icon: WalletCards },
  usage: { title: "Usage", icon: Gauge },
  logs: { title: "Logs", icon: ScrollText },
  observability: { title: "Observability", icon: Activity },
} satisfies Record<ViewKind, { title: string; icon: LucideIcon }>;

function projectLabel(project: Projectish) {
  return project.repositoryLink || `Project ${project.id}`;
}

/** Keep shareable filters in the URL without triggering a navigation. */
function syncQuery(patch: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history.replaceState(null, "", url);
}

function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string;
  description?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="border-border bg-surface-subtle text-dim rounded-md border px-4 py-10 text-center text-sm">
      <p className="text-foreground font-medium">
        No {title.toLowerCase()} yet
      </p>
      {description ? (
        <p className="mt-2 text-xs leading-5">{description}</p>
      ) : null}
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          prefetch={false}
          className="bg-primary text-primary-foreground mt-4 inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium hover:opacity-90"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

function appDetailHref(app: Record<string, any>): string | null {
  const applicationId = Number(app.applicationId);
  if (!Number.isSafeInteger(applicationId) || applicationId <= 0) {
    return null;
  }
  return `/operate/observability/${applicationId}`;
}

const STATUS_DOT: Record<string, string> = {
  healthy: "bg-emerald-500",
  not_loaded: "bg-amber-500",
  inactive: "bg-zinc-400",
};

function Sparkline({ points }: { points: number[] }) {
  const max = Math.max(...points, 1);
  const step = points.length > 1 ? 100 / (points.length - 1) : 100;
  const path = points
    .map(
      (p, i) => `${(i * step).toFixed(1)},${(23 - (p / max) * 20).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className="text-dim h-6 w-full"
      aria-hidden
    >
      <polyline
        points={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** 24h count tile with an hourly sparkline; renders nothing without data. */
function TrendTile({
  label,
  count,
  series,
}: {
  label: string;
  count: unknown;
  series?: number[] | null;
}) {
  return (
    <div className="min-w-0">
      <div className="text-dim">{label}</div>
      <div className="text-foreground text-base font-semibold">
        {countLabel(count)}
      </div>
      {series?.length ? <Sparkline points={series} /> : null}
    </div>
  );
}

type ViewState = {
  txAppFilter: string | null;
  setTxAppFilter: (app: string | null) => void;
  txOpen: string | null;
  setTxOpen: (id: string | null) => void;
  logsFilter: LogsPageFilter;
  setLogsFilter: (filter: LogsPageFilter) => void;
  logOpen: string | null;
  setLogOpen: (id: string | null) => void;
};

function Rows({
  kind,
  payload,
  view,
  payment,
}: {
  kind: ViewKind;
  payload: OperatePayload;
  view: ViewState;
  payment: PaymentState | null;
}) {
  if (kind === "transactions") {
    const rows = payload.transactions ?? [];
    if (!rows.length)
      return (
        <EmptyState
          title="Transactions"
          description="On-chain actions from your apps show up here after chat activity."
          actionHref="/projects"
          actionLabel="Open Projects"
        />
      );
    const apps = [...new Set(rows.map((tx) => String(tx.application)))];
    return (
      <TransactionRows
        rows={rows}
        apps={apps}
        appFilter={view.txAppFilter}
        onAppFilterChange={(app) => {
          view.setTxAppFilter(app);
          syncQuery({ app });
        }}
        openId={view.txOpen}
        onToggle={(id) => {
          view.setTxOpen(id);
          syncQuery({ tx: id });
        }}
      />
    );
  }

  if (kind === "usage") {
    const daily = payload.daily ?? [];
    const breakdown = payload.breakdown ?? [];
    if (!daily.length && !breakdown.length && !payload.statement)
      return (
        <EmptyState
          title="Usage"
          description="Credits and tokens appear after your apps run chat turns. This is a meter, not Billing."
          actionHref="/projects"
          actionLabel="Open Projects"
        />
      );
    return <UsageRows payload={payload} />;
  }

  if (kind === "logs") {
    const rows = payload.logs ?? [];
    if (!rows.length) return <EmptyState title="Logs" />;
    const apps = [...new Set(rows.map((row) => String(row.application)))];
    const tools = [
      ...new Set(
        rows.filter((row) => row.tool != null).map((row) => String(row.tool)),
      ),
    ];
    return (
      <LogRows
        rows={rows}
        apps={apps}
        tools={tools}
        filter={view.logsFilter}
        onFilterChange={(filter) => {
          view.setLogsFilter(filter);
          syncQuery({
            app: filter.app,
            tool: filter.tool,
            errors: filter.errorsOnly ? "1" : null,
            payments: filter.paymentsOnly ? "1" : null,
          });
        }}
        openId={view.logOpen}
        onToggle={view.setLogOpen}
      />
    );
  }

  const apps = payload.apps ?? [];
  if (!apps.length) return <EmptyState title="Observability" />;
  const monitoring = payload.monitoring;
  const platformMetrics = payload.platformMetrics ?? [];
  const dashboardLinks = payload.dashboardLinks ?? [];
  const payments = payment?.payments ?? payload.payments;
  const paymentSummary = payments?.summary;
  return (
    <div className="space-y-4">
      <div className="border-border bg-surface-subtle flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
        <div>
          <span className="text-dim">Monitoring</span>{" "}
          <span className="text-foreground">
            {monitoring?.status ?? "unconfigured"}
          </span>
          {monitoring?.windowSeconds ? (
            <span className="text-dim">
              {" "}
              · {Math.round(Number(monitoring.windowSeconds) / 60)}m window
            </span>
          ) : null}
        </div>
        {dashboardLinks.length ? (
          <div className="flex flex-wrap gap-2">
            {dashboardLinks.map((link, index) => (
              <a
                key={`${link.url}-${index}`}
                href={String(link.url)}
                target="_blank"
                rel="noreferrer"
                className="border-border bg-surface hover:bg-accent-hover rounded-md border px-2 py-1 text-xs"
              >
                {link.label || "Open dashboard"}
              </a>
            ))}
          </div>
        ) : null}
      </div>

      {payment?.loading ? (
        <div className="border-border bg-surface rounded-md border px-3 py-3">
          <div className="text-foreground text-sm font-medium">
            Payment health
          </div>
          <div className="text-dim mt-2 text-xs">Loading payment health…</div>
        </div>
      ) : payment?.error ? (
        <div className="border-danger/30 bg-danger/5 rounded-md border px-3 py-3">
          <div className="text-foreground text-sm font-medium">
            Payment health
          </div>
          <div className="text-danger mt-1 text-xs">{payment.error}</div>
          <button
            type="button"
            onClick={payment.retry}
            className="border-border bg-surface hover:bg-accent-hover mt-2 rounded-md border px-2 py-1 text-xs"
          >
            Retry
          </button>
        </div>
      ) : payments?.available ||
        (Array.isArray(payments?.resources) && payments.resources.length) ? (
        <div className="border-border bg-surface rounded-md border">
          <div className="border-border border-b px-3 py-2">
            <div className="text-foreground text-sm font-medium">
              Payment health
            </div>
            <div className="text-dim text-xs">
              24h activity · outstanding is the live recipient-bucket balance
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 px-3 py-3 text-xs lg:grid-cols-4">
            <div>
              <div className="text-dim">Priced calls</div>
              <div className="text-foreground text-base font-semibold">
                {countLabel(paymentSummary?.pricedCalls)}
              </div>
            </div>
            <div>
              <div className="text-dim">Accrued</div>
              <div className="text-foreground text-base font-semibold">
                {usdLabel(paymentSummary?.accruedUsd)}
              </div>
            </div>
            <div>
              <div className="text-dim">Settled</div>
              <div className="text-foreground text-base font-semibold">
                {usdLabel(paymentSummary?.settledUsd)}
              </div>
            </div>
            <div>
              <div className="text-dim">Outstanding</div>
              <div
                className={`text-base font-semibold ${
                  Number(paymentSummary?.outstandingUsd ?? 0) > 0
                    ? "text-amber-500"
                    : "text-emerald-500"
                }`}
              >
                {usdLabel(paymentSummary?.outstandingUsd)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {apps.map((app) => {
          const metrics = app.metrics ?? {};
          const hasTrend =
            metrics.chats24h != null ||
            metrics.toolCalls24h != null ||
            metrics.transactions24h != null;
          const hasErrorSplit =
            metrics.toolErrorRate != null || metrics.txErrorRate != null;
          const lifecycle = [
            app.sdkVersion ? `SDK ${app.sdkVersion}` : null,
            Object.keys(app.pricing?.config?.resources ?? {}).length
              ? `${Object.keys(app.pricing.config.resources).length} priced tool${Object.keys(app.pricing.config.resources).length === 1 ? "" : "s"}`
              : null,
            metrics.coldStartMs != null
              ? `cold start ${unitLabel(metrics.coldStartMs, "ms", 0)}`
              : null,
            bytesLabel(metrics.dylibBytes),
          ].filter(Boolean);
          const detailHref = appDetailHref(app);
          const card = (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {app.application}
                  </div>
                  <div className="text-dim truncate text-xs">
                    {app.releaseTag ?? "No release"}
                  </div>
                </div>
                <span className="text-dim flex items-center gap-1.5 text-xs">
                  <span
                    className={`size-2 rounded-full ${STATUS_DOT[String(app.status)] ?? "bg-zinc-400"}`}
                  />
                  {app.status}
                </span>
              </div>
              {hasTrend ? (
                <div className="mt-3 grid grid-cols-3 gap-x-3 text-xs">
                  <TrendTile
                    label="Chats 24h"
                    count={metrics.chats24h}
                    series={metrics.chatsHourly}
                  />
                  <TrendTile
                    label="Tool calls 24h"
                    count={metrics.toolCalls24h}
                    series={metrics.toolCallsHourly}
                  />
                  <TrendTile
                    label="Tx 24h"
                    count={metrics.transactions24h}
                    series={metrics.transactionsHourly}
                  />
                </div>
              ) : null}
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                {hasTrend ? null : (
                  <div>
                    <div className="text-dim">Requests/min</div>
                    <div className="text-foreground font-medium">
                      {numberLabel(metrics.requestsPerMinute)}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-dim">
                    {hasErrorSplit ? "Chat errors" : "Error rate"}
                  </div>
                  <div className="text-foreground font-medium">
                    {percentLabel(metrics.errorRate)}
                  </div>
                </div>
                {hasErrorSplit ? (
                  <>
                    <div>
                      <div className="text-dim">Tool errors</div>
                      <div className="text-foreground font-medium">
                        {percentLabel(metrics.toolErrorRate)}
                      </div>
                    </div>
                    <div>
                      <div className="text-dim">Tx failures</div>
                      <div className="text-foreground font-medium">
                        {percentLabel(metrics.txErrorRate)}
                      </div>
                    </div>
                  </>
                ) : null}
                <div>
                  <div className="text-dim">P95 latency</div>
                  <div className="text-foreground font-medium">
                    {unitLabel(metrics.p95LatencyMs, "ms", 0)}
                  </div>
                </div>
                <div>
                  <div className="text-dim">Inflight</div>
                  <div className="text-foreground font-medium">
                    {numberLabel(metrics.inflightRequests, 0)}
                  </div>
                </div>
              </div>
              {lifecycle.length ? (
                <div className="border-border text-dim mt-3 border-t pt-2 text-xs">
                  {lifecycle.join(" · ")}
                </div>
              ) : null}
            </>
          );
          const key = `${app.project?.id}-${app.applicationId}`;
          const className =
            "border-border bg-surface rounded-md border px-3 py-3";
          return detailHref ? (
            <ControlPlaneLink
              key={key}
              href={detailHref}
              aria-label={`Open ${app.application} observability details`}
              className={`${className} hover:bg-accent-hover focus-visible:ring-ring transition focus-visible:outline-none focus-visible:ring-1`}
            >
              {card}
            </ControlPlaneLink>
          ) : (
            <div key={key} className={className}>
              {card}
            </div>
          );
        })}
      </div>

      {platformMetrics.length ? (
        <div className="border-border overflow-hidden rounded-md border">
          <table className="divide-border min-w-full divide-y text-sm">
            <thead className="bg-surface-subtle text-dim text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Platform metric</th>
                <th className="px-3 py-2">Value</th>
                <th className="px-3 py-2">Scope</th>
              </tr>
            </thead>
            <tbody className="divide-border bg-surface divide-y">
              {platformMetrics.map((metric, index) => (
                <tr key={`${metric.label}-${index}`}>
                  <td className="px-3 py-2">
                    <div>{metric.label}</div>
                    {metric.description ? (
                      <div className="text-dim text-xs">
                        {metric.description}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {unitLabel(metric.value, String(metric.unit ?? ""))}
                  </td>
                  <td className="text-dim px-3 py-2">{metric.scope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function projectIdFromSearch(raw: string | null): number | null {
  if (!raw) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function OperateView({ kind }: { kind: ViewKind }) {
  const { account } = useGitHubSession();
  const searchParams = useSearchParams();
  const projectFromUrl = projectIdFromSearch(searchParams.get("project"));
  const appFromUrl = searchParams.get("app");
  const toolFromUrl = searchParams.get("tool");
  const errorsFromUrl = searchParams.get("errors") === "1";
  const paymentsFromUrl = searchParams.get("payments") === "1";
  const txFromUrl = searchParams.get("tx");
  const accountKey = githubAccountKey(account.githubLogin);
  const [projectId, setSourceId] = useState<number | null>(projectFromUrl);
  const [txAppFilter, setTxAppFilter] = useState<string | null>(appFromUrl);
  const [txOpen, setTxOpen] = useState<string | null>(txFromUrl);
  const [logsFilter, setLogsFilter] = useState<LogsPageFilter>({
    ...EMPTY_LOGS_PAGE_FILTER,
    app: appFromUrl,
    tool: toolFromUrl,
    errorsOnly: errorsFromUrl,
    paymentsOnly: paymentsFromUrl,
  });
  const [logOpen, setLogOpen] = useState<string | null>(null);
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = buildQueryKeys.operate(
    accountKey ?? "unavailable",
    kind,
    projectId,
  );
  const dataQuery = useQuery({
    queryKey,
    queryFn: () => operateFetch<OperatePayload>(kind, { projectId }),
    enabled: account.signedIn && accountKey !== null,
    staleTime: buildQueryStaleTime.operate,
  });
  // The payment ledger is optional and source-scoped. Start it only after the
  // monitoring snapshot has resolved so a slow ledger never holds the page.
  const paymentQuery = useQuery({
    queryKey: buildQueryKeys.operate(
      accountKey ?? "unavailable",
      "payments",
      projectId,
    ),
    queryFn: () => operatePaymentsFetch<PaymentPayload>({ projectId }),
    enabled:
      kind === "observability" &&
      dataQuery.isSuccess &&
      account.signedIn &&
      accountKey !== null,
    staleTime: buildQueryStaleTime.operate,
  });
  const payload = dataQuery.data ?? null;
  const loading = dataQuery.isPending;
  const queryError =
    dataQuery.error && !dataQuery.data
      ? dataQuery.error instanceof Error
        ? dataQuery.error.message
        : String(dataQuery.error)
      : null;
  const error = paginationError ?? queryError;
  const payment: PaymentState | null =
    kind === "observability"
      ? {
          payments: paymentQuery.data?.payments ?? null,
          loading: paymentQuery.isLoading,
          error: paymentQuery.isError
            ? paymentQuery.error instanceof Error
              ? paymentQuery.error.message
              : String(paymentQuery.error)
            : null,
          retry: () => {
            void paymentQuery.refetch();
          },
        }
      : null;
  const Icon = meta[kind].icon;
  const projects = useMemo(() => payload?.projects ?? [], [payload?.projects]);
  const canPage = kind === "transactions" || kind === "logs";
  const nextCursor = canPage ? payload?.nextCursor : null;

  useEffect(() => {
    if (projectFromUrl != null) setSourceId(projectFromUrl);
  }, [projectFromUrl]);

  // Deep links (?app=&tool=&errors=&tx=) win over local filter state so a
  // pasted investigation URL always lands on what it pointed at.
  useEffect(() => {
    if (appFromUrl != null) {
      setTxAppFilter(appFromUrl);
      setLogsFilter((current) => ({ ...current, app: appFromUrl }));
    }
  }, [appFromUrl]);
  useEffect(() => {
    if (toolFromUrl != null) {
      setLogsFilter((current) => ({ ...current, tool: toolFromUrl }));
    }
  }, [toolFromUrl]);
  useEffect(() => {
    if (txFromUrl != null) setTxOpen(txFromUrl);
  }, [txFromUrl]);
  useEffect(() => {
    setPaginationError(null);
  }, [accountKey, kind, projectId]);

  if (account.loading) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <LoadingPanel label="Checking GitHub session..." />
      </div>
    );
  }

  if (!account.signedIn) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <GitHubSignInPanel error={null} />
      </div>
    );
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setPaginationError(null);
    try {
      const next = await operateFetch<OperatePayload>(kind, {
        projectId,
        cursor: nextCursor,
      });
      queryClient.setQueryData<OperatePayload>(queryKey, (current) => {
        if (!current) {
          return next;
        }
        let merged: OperatePayload;
        if (kind === "transactions") {
          merged = {
            ...next,
            projects: current.projects ?? next.projects,
            transactions: [
              ...(current.transactions ?? []),
              ...(next.transactions ?? []),
            ],
          };
        } else if (kind === "logs") {
          merged = {
            ...next,
            projects: current.projects ?? next.projects,
            logs: [...(current.logs ?? []), ...(next.logs ?? [])],
          };
        } else {
          merged = next;
        }
        return merged;
      });
    } catch (err) {
      setPaginationError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const view: ViewState = {
    txAppFilter,
    setTxAppFilter,
    txOpen,
    setTxOpen,
    logsFilter,
    setLogsFilter,
    logOpen,
    setLogOpen,
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="text-dim size-5" />
          <h1 className="font-display text-xl font-normal tracking-tight">
            {meta[kind].title}
          </h1>
          {payload?.example ? (
            <span
              title="Live data for this view isn't connected yet — showing example data."
              className="border-border bg-surface-subtle text-dim rounded-full border px-2 py-0.5 text-xs"
            >
              Example data
            </span>
          ) : null}
        </div>
        <label className="text-dim flex items-center gap-2 text-sm">
          <ListFilter className="size-4" />
          <select
            value={projectId ?? ""}
            onChange={(event) =>
              setSourceId(
                event.target.value ? Number(event.target.value) : null,
              )
            }
            className="border-border bg-surface text-foreground h-9 rounded-md border px-2"
          >
            <option value="">All projects</option>
            {projects.map((source) => (
              <option key={source.id} value={source.id}>
                {projectLabel(source)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading ? (
        <div className="border-border bg-surface-subtle text-dim rounded-md border px-4 py-10 text-center text-sm">
          Loading
        </div>
      ) : error ? (
        <div className="border-danger/30 bg-danger/5 text-danger rounded-md border px-4 py-3 text-sm">
          {error}
        </div>
      ) : payload ? (
        <>
          <Rows kind={kind} payload={payload} view={view} payment={payment} />
          {nextCursor ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="border-border bg-surface hover:bg-accent-hover disabled:text-dim h-9 rounded-md border px-3 text-sm"
              >
                {loadingMore ? "Loading" : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
