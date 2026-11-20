import type { UserProjectRef } from "@aomi-labs/deploy";
import { UrlLink as Link } from "@/components/url-link";
import {
  useLocation,
  useRouter,
  type RouterHistory,
} from "@tanstack/react-router";
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
import { PageHeader, pageFrame } from "@/components/control-plane/page";
import { Select } from "@/components/select";

// OperateView renders every operate surface except Channels, which has its own
// dedicated ChannelsView (register form + table) instead of the generic
// kind-indexed rows below.
export type ViewKind = Exclude<OperateKind, "channels" | "usage">;

type OperatePayload = {
  /** The real projects among the agents shown; empty when the builder has none. */
  projects?: UserProjectRef[];
  transactions?: Array<Record<string, any>>;
  daily?: Array<Record<string, any>>;
  breakdown?: Array<Record<string, any>>;
  statement?: Record<string, any> | null;
  logs?: Array<Record<string, any>>;
  agents?: Array<Record<string, any>>;
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

const meta: Record<ViewKind, { title: string; summary?: string }> = {
  transactions: { title: "Transactions" },
  logs: {
    title: "Logs",
    summary:
      "Every tool call, with its input, result and timing. Open a row to see the call.",
  },
  observability: {
    title: "Health",
    summary:
      "How your agents are running. Open one for charts, tools and recent events.",
  },
};

function projectLabel({ project }: UserProjectRef) {
  return project.repositoryLink || `Project ${project.id}`;
}

/** Keep shareable filters in the current history entry. */
function syncQuery(
  history: RouterHistory,
  patch: Record<string, string | null>,
) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  history.replace(url.pathname + url.search + url.hash, history.location.state);
  history.flush();
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
    <div className="border-border bg-surface-subtle text-aomi-muted rounded-control border px-4 py-10 text-center text-sm">
      <p className="text-foreground font-medium">
        No {title.toLowerCase()} yet
      </p>
      {description ? (
        <p className="mt-2 text-xs leading-5">{description}</p>
      ) : null}
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          preload={false}
          className="bg-aomi-fg text-aomi-bg mt-4 inline-flex h-8 items-center justify-center rounded-control px-3 text-xs font-medium hover:opacity-90"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

function agentDetailHref(agent: Record<string, any>): string | null {
  const agentId = Number(agent.agentId);
  if (!Number.isSafeInteger(agentId) || agentId <= 0) {
    return null;
  }
  return `/operate/observability/${agentId}`;
}

const STATUS_DOT: Record<string, string> = {
  healthy: "bg-aomi-success",
  not_loaded: "bg-aomi-warning",
  inactive: "bg-aomi-surface-2",
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
      className="text-aomi-muted h-6 w-full"
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
      <div className="text-aomi-muted">{label}</div>
      <div className="text-foreground text-base font-semibold">
        {countLabel(count)}
      </div>
      {series?.length ? <Sparkline points={series} /> : null}
    </div>
  );
}

type ViewState = {
  txAgentFilter: string | null;
  setTxAgentFilter: (agent: string | null) => void;
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
  const { history } = useRouter();
  if (kind === "transactions") {
    const rows = payload.transactions ?? [];
    if (!rows.length)
      return (
        <EmptyState
          title="Transactions"
          description="On-chain actions from your agents show up here after chat activity."
          actionHref="/agents"
          actionLabel="Open Agents"
        />
      );
    const agents = [...new Set(rows.map((tx) => String(tx.agent)))];
    return (
      <TransactionRows
        rows={rows}
        agents={agents}
        agentFilter={view.txAgentFilter}
        onAgentFilterChange={(agent) => {
          view.setTxAgentFilter(agent);
          syncQuery(history, { agent });
        }}
        openId={view.txOpen}
        onToggle={(id) => {
          view.setTxOpen(id);
          syncQuery(history, { tx: id });
        }}
      />
    );
  }

  if (kind === "logs") {
    const rows = payload.logs ?? [];
    if (!rows.length) return <EmptyState title="Logs" />;
    const agents = [...new Set(rows.map((row) => String(row.agent)))];
    const tools = [
      ...new Set(
        rows.filter((row) => row.tool != null).map((row) => String(row.tool)),
      ),
    ];
    return (
      <LogRows
        rows={rows}
        agents={agents}
        tools={tools}
        filter={view.logsFilter}
        onFilterChange={(filter) => {
          view.setLogsFilter(filter);
          syncQuery(history, {
            agent: filter.agent,
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

  const agents = payload.agents ?? [];
  if (!agents.length) return <EmptyState title="Health" />;
  const monitoring = payload.monitoring;
  const platformMetrics = payload.platformMetrics ?? [];
  const dashboardLinks = payload.dashboardLinks ?? [];
  const payments = payment?.payments ?? payload.payments;
  const paymentSummary = payments?.summary;
  return (
    <div className="space-y-4">
      <div className="border-border bg-surface-subtle flex flex-wrap items-center justify-between gap-3 rounded-control border px-3 py-2 text-sm">
        <div>
          <span className="text-aomi-muted">Monitoring</span>{" "}
          <span className="text-foreground">
            {monitoring?.status ?? "unconfigured"}
          </span>
          {monitoring?.windowSeconds ? (
            <span className="text-aomi-muted">
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
                className="border-border bg-surface hover:bg-aomi-hover rounded-control border px-2 py-1 text-xs"
              >
                {link.label || "Open dashboard"}
              </a>
            ))}
          </div>
        ) : null}
      </div>

      {payment?.loading ? (
        <div className="border-border bg-surface rounded-control border px-3 py-3">
          <div className="text-foreground text-sm font-medium">
            Payment health
          </div>
          <div className="text-aomi-muted mt-2 text-xs">Loading payment health…</div>
        </div>
      ) : payment?.error ? (
        <div className="border-danger/30 bg-danger/5 rounded-control border px-3 py-3">
          <div className="text-foreground text-sm font-medium">
            Payment health
          </div>
          <div className="text-danger mt-1 text-xs">{payment.error}</div>
          <button
            type="button"
            onClick={payment.retry}
            className="border-border bg-surface hover:bg-aomi-hover mt-2 rounded-control border px-2 py-1 text-xs"
          >
            Retry
          </button>
        </div>
      ) : payments?.available ||
        (Array.isArray(payments?.resources) && payments.resources.length) ? (
        <div className="border-border bg-surface rounded-control border">
          <div className="border-border border-b px-3 py-2">
            <div className="text-foreground text-sm font-medium">
              Payment health
            </div>
            <div className="text-aomi-muted text-xs">
              24h activity · outstanding is the live recipient-bucket balance
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 px-3 py-3 text-xs lg:grid-cols-4">
            <div>
              <div className="text-aomi-muted">Priced calls</div>
              <div className="text-foreground text-base font-semibold">
                {countLabel(paymentSummary?.pricedCalls)}
              </div>
            </div>
            <div>
              <div className="text-aomi-muted">Accrued</div>
              <div className="text-foreground text-base font-semibold">
                {usdLabel(paymentSummary?.accruedUsd)}
              </div>
            </div>
            <div>
              <div className="text-aomi-muted">Settled</div>
              <div className="text-foreground text-base font-semibold">
                {usdLabel(paymentSummary?.settledUsd)}
              </div>
            </div>
            <div>
              <div className="text-aomi-muted">Outstanding</div>
              <div
                className={`text-base font-semibold ${
                  Number(paymentSummary?.outstandingUsd ?? 0) > 0
                    ? "text-aomi-warning"
                    : "text-aomi-success"
                }`}
              >
                {usdLabel(paymentSummary?.outstandingUsd)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => {
          const metrics = agent.metrics ?? {};
          const hasTrend =
            metrics.chats24h != null ||
            metrics.toolCalls24h != null ||
            metrics.transactions24h != null;
          const hasErrorSplit =
            metrics.toolErrorRate != null || metrics.txErrorRate != null;
          const lifecycle = [
            agent.sdkVersion ? `SDK ${agent.sdkVersion}` : null,
            Object.keys(agent.pricing?.config?.resources ?? {}).length
              ? `${Object.keys(agent.pricing.config.resources).length} priced tool${Object.keys(agent.pricing.config.resources).length === 1 ? "" : "s"}`
              : null,
            metrics.coldStartMs != null
              ? `cold start ${unitLabel(metrics.coldStartMs, "ms", 0)}`
              : null,
          ].filter(Boolean);
          const detailHref = agentDetailHref(agent);
          const card = (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {agent.agent}
                  </div>
                  <div className="text-aomi-muted truncate text-xs">
                    {agent.releaseTag ?? "No release"}
                  </div>
                </div>
                <span className="text-aomi-muted flex items-center gap-1.5 text-xs">
                  <span
                    className={`size-2 rounded-full ${STATUS_DOT[String(agent.status)] ?? "bg-aomi-surface-2"}`}
                  />
                  {agent.status}
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
                    <div className="text-aomi-muted">Requests/min</div>
                    <div className="text-foreground font-medium">
                      {numberLabel(metrics.requestsPerMinute)}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-aomi-muted">
                    {hasErrorSplit ? "Chat errors" : "Error rate"}
                  </div>
                  <div className="text-foreground font-medium">
                    {percentLabel(metrics.errorRate)}
                  </div>
                </div>
                {hasErrorSplit ? (
                  <>
                    <div>
                      <div className="text-aomi-muted">Tool errors</div>
                      <div className="text-foreground font-medium">
                        {percentLabel(metrics.toolErrorRate)}
                      </div>
                    </div>
                    <div>
                      <div className="text-aomi-muted">Tx failures</div>
                      <div className="text-foreground font-medium">
                        {percentLabel(metrics.txErrorRate)}
                      </div>
                    </div>
                  </>
                ) : null}
                <div>
                  <div className="text-aomi-muted">P95 latency</div>
                  <div className="text-foreground font-medium">
                    {unitLabel(metrics.p95LatencyMs, "ms", 0)}
                  </div>
                </div>
                <div>
                  <div className="text-aomi-muted">Inflight</div>
                  <div className="text-foreground font-medium">
                    {numberLabel(metrics.inflightRequests, 0)}
                  </div>
                </div>
              </div>
              {lifecycle.length ? (
                <div className="border-border text-aomi-muted mt-3 border-t pt-2 text-xs">
                  {lifecycle.join(" · ")}
                </div>
              ) : null}
            </>
          );
          const key = String(agent.agentId);
          const className =
            "border-border bg-surface rounded-control border px-3 py-3";
          return detailHref ? (
            <ControlPlaneLink
              key={key}
              href={detailHref}
              aria-label={`Open ${agent.agent} observability details`}
              className={`${className} hover:bg-aomi-hover focus-visible:ring-aomi-ring transition focus-visible:outline-none focus-visible:ring-1`}
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
        <div className="border-border overflow-hidden rounded-control border">
          <table className="divide-border min-w-full divide-y text-sm">
            <thead className="bg-surface-subtle text-aomi-muted text-left text-xs uppercase">
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
                      <div className="text-aomi-muted text-xs">
                        {metric.description}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {unitLabel(metric.value, String(metric.unit ?? ""))}
                  </td>
                  <td className="text-aomi-muted px-3 py-2">{metric.scope}</td>
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
  const searchParams = new URLSearchParams(
    useLocation({ select: (location) => location.searchStr }),
  );
  const projectFromUrl = projectIdFromSearch(searchParams.get("project"));
  const agentFromUrl = searchParams.get("agent");
  const toolFromUrl = searchParams.get("tool");
  const errorsFromUrl = searchParams.get("errors") === "1";
  const paymentsFromUrl = searchParams.get("payments") === "1";
  const txFromUrl = searchParams.get("tx");
  const accountKey = githubAccountKey(account.githubLogin);
  const [projectId, setSourceId] = useState<number | null>(projectFromUrl);
  const [txAgentFilter, setTxAgentFilter] = useState<string | null>(
    agentFromUrl,
  );
  const [txOpen, setTxOpen] = useState<string | null>(txFromUrl);
  const [logsFilter, setLogsFilter] = useState<LogsPageFilter>({
    ...EMPTY_LOGS_PAGE_FILTER,
    agent: agentFromUrl,
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
  const projects = useMemo(() => payload?.projects ?? [], [payload?.projects]);
  const canPage = kind === "transactions" || kind === "logs";
  const nextCursor = canPage ? payload?.nextCursor : null;

  useEffect(() => {
    if (projectFromUrl != null) setSourceId(projectFromUrl);
  }, [projectFromUrl]);

  // Deep links (?agent=&tool=&errors=&tx=) win over local filter state so a
  // pasted investigation URL always lands on what it pointed at.
  useEffect(() => {
    if (agentFromUrl != null) {
      setTxAgentFilter(agentFromUrl);
      setLogsFilter((current) => ({ ...current, agent: agentFromUrl }));
    }
  }, [agentFromUrl]);
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
      <div className={pageFrame}>
        <LoadingPanel label="Checking GitHub session..." />
      </div>
    );
  }

  if (!account.signedIn) {
    return (
      <div className={pageFrame}>
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
    txAgentFilter,
    setTxAgentFilter,
    txOpen,
    setTxOpen,
    logsFilter,
    setLogsFilter,
    logOpen,
    setLogOpen,
  };

  return (
    <div className={pageFrame}>
      <PageHeader
        title={meta[kind].title}
        summary={meta[kind].summary ? <p>{meta[kind].summary}</p> : null}
        actions={
          projects.length ? (
            <Select
              label="Project"
              value={projectId == null ? "" : String(projectId)}
              onChange={(value) => setSourceId(value ? Number(value) : null)}
              options={[
                { value: "", label: "All" },
                ...projects.map((ref) => ({
                  value: String(ref.project.id),
                  label: projectLabel(ref),
                })),
              ]}
            />
          ) : null
        }
      />
      {loading ? (
        <div className="border-border bg-surface-subtle text-aomi-muted rounded-control border px-4 py-10 text-center text-sm">
          Loading
        </div>
      ) : error ? (
        <div className="border-danger/30 bg-danger/5 text-danger rounded-control border px-4 py-3 text-sm">
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
                className="border-border bg-surface hover:bg-aomi-hover disabled:text-aomi-muted h-9 rounded-control border px-3 text-sm"
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
