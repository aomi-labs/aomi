import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Aomi } from "@aomi-labs/client";
import { Plus } from "lucide-react";
import { aomiButton, PackageTile, StatusPill } from "@aomi-labs/widget/host-composition";

import { UrlLink as Link } from "@/components/url-link";
import { PageHeader, pageFrame } from "@/components/control-plane/page";
import {
  ErrorPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";
import { operateFetch } from "@/features/operate/client";

import { shortName } from "./client";
import { useAgents, usePublisher } from "./hooks";
import { channelLabel } from "./inventory-view";
import { AgentMark, Card, Cell, EmptyRow, ListHeader, Row } from "./ui";

const PERIODS = ["7 days", "30 days", "This month"] as const;
type Period = (typeof PERIODS)[number];

export function fromDate(period: Period) {
  const now = new Date();
  if (period === "This month")
    return `${now.toISOString().slice(0, 8)}01`;
  const days = period === "7 days" ? 6 : 29;
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export type UsageDay = { agent?: string; creditsUsed?: number };
export type Usage = {
  daily?: UsageDay[];
  /** `available` is false when the statement could not be read. */
  statement?: {
    available: boolean;
    revenue: { subject: string; events: number }[];
  };
};

/** Tool calls billed in a usage read; null when the statement could not be read. */
export const toolCalls = (usage: Usage) =>
  usage.statement?.available
    ? usage.statement.revenue
        .filter((row) => row.subject === "tool_invocation")
        .reduce((sum, row) => sum + row.events, 0)
    : null;

/** Model credits per agent name over a period, from the Usage read. */
export function useUsage(from: string) {
  return useQuery({
    queryKey: ["build", "usage", from],
    queryFn: () => operateFetch<Usage>("usage", { fromDate: from }),
    retry: false,
  });
}


const usd = (micro: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    micro / 1_000_000,
  );

/** Model cost per agent and where each package is used; the builder's credit balance. */
export function UsageView() {
  const [period, setPeriod] = useState<Period>("7 days");
  const publisher = usePublisher();
  const agents = useAgents(publisher.data?.agents.map((agent) => agent.id) ?? []);
  const usage = useUsage(fromDate(period));
  const credits = useQuery({
    queryKey: ["builder-credits"],
    queryFn: () => new Aomi({ baseUrl: "", guest: false }).builder.credits.get(),
    retry: false,
  });
  if (publisher.isPending) return <LoadingPanel label="Loading usage…" />;
  if (publisher.error) return <ErrorPanel message={publisher.error.message} />;

  const creditsOf = (names: string[]) =>
    (usage.data?.daily ?? [])
      .filter((day) => day.agent && names.includes(day.agent))
      .reduce((sum, day) => sum + (day.creditsUsed ?? 0), 0);
  const usedIn = (id: string) =>
    agents
      .filter((agent) => agent?.live?.config.packages.includes(id))
      .map((agent) => agent!.agent.display_name);

  return (
    <div className={pageFrame}>
      <PageHeader
        title="Usage"
        summary={
          <p>
            Chats and model cost are counted per agent. Tool calls, fees and
            hosting are counted per package, wherever it is used.
          </p>
        }
        actions={
          <div
            role="tablist"
            aria-label="Period"
            className="bg-aomi-surface-2 rounded-control inline-flex gap-0.5 p-[3px]"
          >
            {PERIODS.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={period === name}
                onClick={() => setPeriod(name)}
                className={`inline-flex h-[26px] items-center rounded-md px-[11px] text-[12px] font-medium ${period === name ? "bg-aomi-raised text-aomi-fg ring-aomi-border ring-1" : "text-aomi-muted hover:text-aomi-fg"}`}
              >
                {name}
              </button>
            ))}
          </div>
        }
      />
      <Card
        title="By agent"
        action={
          <span className="type-meta text-aomi-muted">
            A chat belongs to one agent
          </span>
        }
        footer={usage.error ? `Usage could not be read: ${usage.error.message}` : null}
      >
        <ListHeader
          title="Agent"
          columns={[
            { label: "Channels", width: 240 },
            { label: "Model cost", width: 120 },
            { label: "Paid by", width: 160 },
          ]}
        />
        {publisher.data.agents.length === 0 ? (
          <EmptyRow>No agents yet</EmptyRow>
        ) : (
          publisher.data.agents.map((agent, index) => {
            const detail = agents[index];
            const config = detail?.live?.config;
            return (
              <Row
                key={agent.id}
                leading={<AgentMark />}
                label={agent.display_name}
                hint="Your agent"
              >
                <Cell width={240}>
                  <span className="flex flex-wrap gap-1">
                    {(detail?.channels ?? []).map((channel) => (
                      <span
                        key={channel.id}
                        className="border-aomi-border bg-aomi-surface inline-flex h-6 items-center rounded-full border px-2 text-[12px]"
                      >
                        {channelLabel(channel.kind)}
                      </span>
                    ))}
                    {detail && detail.channels.length === 0 ? (
                      <span className="type-meta text-aomi-muted">No channels</span>
                    ) : null}
                  </span>
                </Cell>
                <Cell width={120}>
                  <span className="text-[13px]">
                    {usage.data
                      ? `${creditsOf([agent.display_name, shortName(agent.id), agent.id]).toLocaleString("en-US")} credits`
                      : "—"}
                  </span>
                </Cell>
                <Cell width={160}>
                  {config ? (
                    <StatusPill tone={config.model_cost === "builder" ? "accent" : "neutral"}>
                      {config.model_cost === "builder"
                        ? "You pay"
                        : "Each person's balance"}
                    </StatusPill>
                  ) : null}
                </Cell>
              </Row>
            );
          })
        )}
      </Card>
      <Card
        title="By package"
        action={
          <span className="type-meta text-aomi-muted">
            Where each package is used
          </span>
        }
      >
        <ListHeader
          title="Package"
          columns={[{ label: "Used in", width: 300 }]}
        />
        {publisher.data.packages.length === 0 ? (
          <EmptyRow>No packages yet</EmptyRow>
        ) : (
          publisher.data.packages.map((pkg) => (
            <Row
              key={pkg.id}
              leading={<PackageTile iconUrl={pkg.icon_url} />}
              label={
                <>
                  <span className="text-aomi-muted font-normal">
                    {publisher.data.publisher}/
                  </span>
                  {shortName(pkg.id)}
                </>
              }
            >
              <Cell width={300}>
                <span className="flex flex-wrap gap-1">
                  {usedIn(pkg.id).map((name) => (
                    <span
                      key={name}
                      className="border-aomi-border bg-aomi-surface inline-flex h-6 items-center rounded-full border px-2 text-[12px]"
                    >
                      {name}
                    </span>
                  ))}
                  {pkg.listed && pkg.live_release != null ? (
                    <span className="border-aomi-border bg-aomi-surface inline-flex h-6 items-center rounded-full border px-2 text-[12px]">
                      Aomi Chat
                    </span>
                  ) : null}
                  {pkg.live_release == null ? (
                    <span className="type-meta text-aomi-muted">Not live</span>
                  ) : null}
                </span>
              </Cell>
            </Row>
          ))
        )}
      </Card>
      <Card
        title="Builder credits"
        action={
          <span className="type-meta text-aomi-muted">
            Pays hosting and the model cost you cover
          </span>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[24px] font-semibold leading-7 tracking-[-0.02em]">
              {credits.data ? usd(credits.data.balance_microusd) : "—"}
            </span>
            <span className="type-meta text-aomi-muted">
              {credits.error
                ? `Balance could not be read: ${credits.error.message}`
                : "Separate from your personal Aomi Chat balance."}
            </span>
          </div>
          <Link
            href="/settings/billing"
            className={aomiButton({ variant: "primary" })}
          >
            <Plus />
            Add credits
          </Link>
        </div>
      </Card>
    </div>
  );
}
