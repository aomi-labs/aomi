import { Plus } from "lucide-react";
import { aomiButton, PackageMark, StatusPill } from "@aomi-labs/widget/host-composition";

import { UrlLink as Link } from "@/components/url-link";
import { PageHeader, pageFrame } from "@/components/control-plane/page";
import {
  ErrorPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";

import { releaseLabel, shortName, type Agent, type Package } from "./client";
import { useAgents, useAllReleases, usePackages, usePublisher } from "./hooks";
import { agentStatus, channelLabel, packageStatus } from "./inventory-view";
import { fromDate, toolCalls, useUsage } from "./usage-view";
import { Card, Cell, EmptyRow, Mono, Row, Tile, plural } from "./ui";

const ROW_LINK =
  "after:absolute after:inset-0 after:content-[''] hover:underline";

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint: React.ReactNode;
}) {
  return (
    <div className="border-aomi-border bg-aomi-raised rounded-card flex flex-col gap-1.5 border p-4">
      <span className="type-meta text-aomi-muted">{label}</span>
      <span className="text-[24px] font-semibold leading-7 tracking-[-0.02em]">
        {value}
      </span>
      <span className="type-meta text-aomi-muted truncate">{hint}</span>
    </div>
  );
}

const ViewAll = ({ href }: { href: string }) => (
  <Link href={href} className="type-meta text-aomi-muted hover:text-aomi-fg">
    View all
  </Link>
);

function counts(pkg: Package | undefined, usedBy: string[]) {
  if (!pkg?.live) return null;
  return [
    plural(pkg.live.skills.length, "skill"),
    plural(pkg.live.tools.length, "tool"),
    usedBy.length ? `used by ${usedBy.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function channelsOf(agent: Agent | undefined) {
  return [...new Set((agent?.channels ?? []).map((c) => channelLabel(c.kind)))];
}

/** Build's home: counts, the package and agent lists and the newest releases. */
export function OverviewView() {
  const { data, error, isPending } = usePublisher();
  const packages = usePackages(data?.packages.map((pkg) => pkg.id) ?? []);
  const agents = useAgents(data?.agents.map((agent) => agent.id) ?? []);
  const releases = useAllReleases(data);
  const usage = useUsage(fromDate("7 days"));
  if (isPending) return <LoadingPanel label="Loading your overview…" />;
  if (error) return <ErrorPanel message={error.message} />;

  const usedBy = (id: string) =>
    agents
      .filter((agent) => agent?.live?.config.packages.includes(id))
      .map((agent) => agent!.agent.display_name);
  const live = data.packages.filter(
    (pkg) => packageStatus(pkg).tone === "success",
  ).length;
  const channels = [...new Set(agents.flatMap(channelsOf))];

  return (
    <div className={pageFrame}>
      <PageHeader
        title="Overview"
        summary={<p>What you have published and how it is running.</p>}
        actions={
          <Link href="/new" className={aomiButton({ variant: "primary" })}>
            <Plus />
            New
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Packages"
          value={data.packages.length}
          hint={[
            `${live} live`,
            live < data.packages.length
              ? `${data.packages.length - live} not live`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        <Stat
          label="Agents"
          value={data.agents.length}
          hint={[
            data.agents.map((agent) => agent.display_name).join(", "),
            channels.join(", "),
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        {usage.data ? (
          <>
            <Stat
              label="Credits used, 7 days"
              value={(usage.data.daily ?? [])
                .reduce((sum, day) => sum + (day.creditsUsed ?? 0), 0)
                .toLocaleString("en-US")}
              hint="Model cost, counted per agent"
            />
            <Stat
              label="Tool calls, 7 days"
              value={toolCalls(usage.data).toLocaleString("en-US")}
              hint="Billed tool calls across your agents"
            />
          </>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-5">
          <Card
            title="Packages"
            count={data.packages.length}
            action={<ViewAll href="/packages" />}
          >
            {data.packages.length === 0 ? (
              <EmptyRow>No packages yet</EmptyRow>
            ) : (
              data.packages.map((pkg, index) => {
                const status = packageStatus(pkg);
                const detail = packages[index];
                return (
                  <Row
                    key={pkg.id}
                    leading={
                      <Tile>
                        <PackageMark iconUrl={pkg.icon_url} className="size-4" />
                      </Tile>
                    }
                    label={
                      <Link
                        href={`/packages/${shortName(pkg.id)}`}
                        className={ROW_LINK}
                      >
                        {pkg.id}
                      </Link>
                    }
                    hint={counts(detail, usedBy(pkg.id))}
                  >
                    <Cell width={72}>
                      {detail?.live?.commit ? (
                        <span className="text-aomi-muted">
                          <Mono>{detail.live.commit.slice(0, 7)}</Mono>
                        </span>
                      ) : null}
                    </Cell>
                    <Cell width={132}>
                      <StatusPill tone={status.tone} dot>
                        {status.label}
                      </StatusPill>
                    </Cell>
                  </Row>
                );
              })
            )}
          </Card>
          <Card
            title="Agents"
            count={data.agents.length}
            action={<ViewAll href="/agents" />}
          >
            {data.agents.length === 0 ? (
              <EmptyRow>No agents yet</EmptyRow>
            ) : (
              data.agents.map((agent, index) => {
                const status = agentStatus(agent.status);
                const detail = agents[index];
                const used = detail?.live?.config.packages.length;
                return (
                  <Row
                    key={agent.id}
                    leading={
                      <Tile round>
                        {agent.display_name.charAt(0).toUpperCase()}
                      </Tile>
                    }
                    label={
                      <Link
                        href={`/agents/${shortName(agent.id)}`}
                        className={ROW_LINK}
                      >
                        {agent.display_name}
                      </Link>
                    }
                    hint={[
                      ...channelsOf(detail),
                      used === undefined
                        ? null
                        : `uses ${used} package${used === 1 ? "" : "s"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    <Cell width={132}>
                      <StatusPill tone={status.tone} dot>
                        {status.label}
                      </StatusPill>
                    </Cell>
                  </Row>
                );
              })
            )}
          </Card>
        </div>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col">
          <Card title="Recent releases" action={<ViewAll href="/releases" />}>
            {releases.entries.length === 0 ? (
              <EmptyRow>
                {releases.pending ? "Loading…" : "No releases yet"}
              </EmptyRow>
            ) : (
              releases.entries.slice(0, 4).map((entry) => (
                <div
                  key={`${entry.kind}:${entry.id}:${entry.release.number}`}
                  className="flex items-center gap-3 px-3.5 py-3"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="type-control truncate font-medium">
                      {entry.kind === "agent"
                        ? `${entry.name} config`
                        : shortName(entry.id)}{" "}
                      <span className="text-aomi-muted font-mono font-normal">
                        {releaseLabel(entry.release)}
                      </span>
                    </span>
                    <span className="type-meta text-aomi-muted">
                      {new Date(entry.release.created_at).toLocaleString(
                        "en-GB",
                        {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        },
                      )}
                    </span>
                  </span>
                  <Cell width={84}>
                    <StatusPill tone={entry.live ? "success" : "neutral"}>
                      {entry.live ? "Current" : "Previous"}
                    </StatusPill>
                  </Cell>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
