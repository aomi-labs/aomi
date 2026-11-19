import {
  aomiButton,
  ListGroup,
  PackageTile,
  StatusPill,
  type StatusTone,
} from "@aomi-labs/widget/host-composition";
import { useState, type ReactNode } from "react";
import {
  ChevronRight,
  Code,
  Globe,
  Plus,
  Search,
  Send,
  Terminal,
} from "lucide-react";

import { UrlLink as Link } from "@/components/url-link";
import { PageHeader, pageFrame } from "@/components/control-plane/page";
import {
  ErrorPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";

import { Chains } from "./chains";
import { shortName, type Agent, type Publisher } from "./client";
import { useAgents, usePackages, usePublisher } from "./hooks";
import {
  AgentMark,
  Card,
  Cell,
  EmptyRow,
  ListHeader,
  Mono,
  Row,
  VerifiedCheck,
  packageKind,
  plural,
} from "./ui";

const AGENT_STATUS: Record<
  Publisher["agents"][number]["status"],
  { label: string; tone: StatusTone }
> = {
  active: { label: "Live", tone: "success" },
  inactive: { label: "Inactive", tone: "neutral" },
  needs_rebuild: { label: "Needs a rebuild", tone: "warning" },
  retired: { label: "Retired", tone: "neutral" },
};

export const agentStatus = (status: Publisher["agents"][number]["status"]) =>
  AGENT_STATUS[status] ?? AGENT_STATUS.inactive;

/** A package's state in its publisher's list. */
export function packageStatus(pkg: Publisher["packages"][number]): {
  label: string;
  tone: StatusTone;
} {
  if (!pkg.active) return { label: "Off", tone: "warning" };
  if (pkg.live_release == null) return { label: "No release live", tone: "neutral" };
  return { label: "Live", tone: "success" };
}

const CHANNELS: Record<string, string> = {
  telegram: "Telegram",
  widget: "Widget",
  page: "Page",
  sdk: "SDK and API",
  api: "SDK and API",
  discord: "Discord",
};

/** A channel kind as the UI names it. */
export const channelLabel = (kind: string) => CHANNELS[kind] ?? kind;

/** The row title's link covers the whole row. */
const ROW_LINK =
  "after:absolute after:inset-0 after:content-[''] hover:underline";

const CHANNEL_ICON: Record<string, ReactNode> = {
  telegram: <Send aria-hidden />,
  widget: <Code aria-hidden />,
  page: <Globe aria-hidden />,
  sdk: <Terminal aria-hidden />,
  api: <Terminal aria-hidden />,
};

const RowChevron = () => (
  <ChevronRight className="text-aomi-muted size-4 shrink-0" aria-hidden />
);

/** A muted cell text, for empty states inside a column. */
const Quiet = ({ children }: { children: ReactNode }) => (
  <span className="text-aomi-muted truncate text-[13px]">{children}</span>
);

/** An agent's status, or "No config live" for an active agent without one. */
function agentRowStatus(
  agent: Publisher["agents"][number],
  detail: Agent | undefined,
) {
  if (agent.status === "active" && detail && !detail.live)
    return { label: "No config live", tone: "neutral" as const };
  return agentStatus(agent.status);
}

/** The kinds of an agent's channels, each with its icon. */
function ChannelKinds({ channels }: { channels: Agent["channels"] }) {
  const kinds = [...new Set(channels.map((channel) => channel.kind))];
  return (
    <span className="text-aomi-fg flex min-w-0 items-center gap-1.5 text-[13px] [&_svg]:text-aomi-muted [&_svg]:size-3.5 [&_svg]:shrink-0">
      {kinds.map((kind, index) => (
        <span key={kind} className="flex min-w-0 items-center gap-1.5">
          {index > 0 ? <span className="text-aomi-muted">+</span> : null}
          {CHANNEL_ICON[kind] ?? <Globe aria-hidden />}
          <span className="truncate">{channelLabel(kind)}</span>
        </span>
      ))}
    </span>
  );
}

const AGENT_COLUMNS = [
  { label: "Channels", width: 150 },
  { label: "Packages", width: 100 },
  { label: "Chains", width: 96 },
  { label: "Status", width: 120 },
];

function AgentList({ publisher }: { publisher: Publisher }) {
  const details = useAgents(publisher.agents.map((agent) => agent.id));
  const channels = details.flatMap((agent) =>
    (agent?.channels ?? []).map((channel) => ({
      channel,
      agent: agent!.agent.display_name,
    })),
  );
  return (
    <>
      <section className="flex flex-col gap-2">
        <ListGroup>
          <ListHeader title="Agent" columns={AGENT_COLUMNS} chevron />
          {publisher.agents.length === 0 ? (
            <EmptyRow>No agents yet</EmptyRow>
          ) : (
            publisher.agents.map((agent, index) => {
              const detail = details[index];
              const config = detail?.live?.config;
              const status = agentRowStatus(agent, detail);
              return (
                <Row
                  key={agent.id}
                  leading={<AgentMark />}
                  label={
                    <Link
                      href={`/agents/${shortName(agent.id)}`}
                      className={ROW_LINK}
                    >
                      {agent.display_name}
                    </Link>
                  }
                  hint={<Mono>{agent.id}</Mono>}
                >
                  <Cell width={150}>
                    {!detail ? null : detail.channels.length ? (
                      <ChannelKinds channels={detail.channels} />
                    ) : (
                      <Quiet>No channels yet</Quiet>
                    )}
                  </Cell>
                  <Cell width={100}>
                    {config ? (
                      <span className="text-[13px]">
                        {config.packages.length}
                      </span>
                    ) : null}
                  </Cell>
                  <Cell width={96}>
                    {config ? <Chains chains={config.chains} compact /> : null}
                  </Cell>
                  <Cell width={120}>
                    <StatusPill
                      tone={status.tone}
                      dot={status.tone === "success"}
                    >
                      {status.label}
                    </StatusPill>
                  </Cell>
                  <RowChevron />
                </Row>
              );
            })
          )}
        </ListGroup>
        <p className="type-meta text-aomi-muted px-0.5">
          An agent is added by an <Mono>[[agents]]</Mono> table in{" "}
          <Mono>aomi.toml</Mono>. Commit it and release; the agent shows up
          here. Build only holds channel tokens and which config is live.{" "}
          <a
            href="https://aomi.dev/docs"
            target="_blank"
            rel="noreferrer"
            className="text-aomi-fg font-medium hover:underline"
          >
            How agents are configured
          </a>
        </p>
      </section>
      <Card
        title="Channels"
        action={
          <Link
            href="/operate/channels"
            className="type-meta text-aomi-muted hover:text-aomi-fg"
          >
            Manage channels
          </Link>
        }
      >
        {channels.length === 0 ? (
          <EmptyRow>No channels yet</EmptyRow>
        ) : (
          channels.map(({ channel, agent }) => (
            <Row
              key={channel.id}
              leading={
                <span className="bg-aomi-surface-2 text-aomi-muted rounded-control flex size-8 shrink-0 items-center justify-center [&_svg]:size-4">
                  {CHANNEL_ICON[channel.kind] ?? <Globe aria-hidden />}
                </span>
              }
              label={channel.external_bot_id}
              hint={channelLabel(channel.kind)}
            >
              <Cell width={144}>
                <AgentChip name={agent} />
              </Cell>
              <Cell width={132}>
                <StatusPill
                  tone={channel.live ? "success" : "neutral"}
                  dot={channel.live}
                >
                  {channel.live ? "Active" : "Off"}
                </StatusPill>
              </Cell>
              <Cell width={96} end>
                <Link
                  href="/operate/channels"
                  className={aomiButton({ size: "sm" })}
                >
                  Manage
                </Link>
              </Cell>
            </Row>
          ))
        )}
      </Card>
    </>
  );
}

/** An agent's name in a chip, after its 16px mark. */
function AgentChip({ name }: { name: string }) {
  return (
    <span className="border-aomi-border bg-aomi-raised inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border pl-1 pr-2 text-[12px]">
      <AgentMark size={16} />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** The agents that use a package: one as a chip, more as a count. */
function UsedBy({ names }: { names: string[] }) {
  if (names.length === 0) return <Quiet>No agent yet</Quiet>;
  if (names.length === 1) return <AgentChip name={names[0]} />;
  return <span className="text-[13px]">{plural(names.length, "agent")}</span>;
}

const FILTERS = ["All", "Live", "Not live"] as const;

const PACKAGE_COLUMNS = [
  { label: "Runs as", width: 112 },
  { label: "Contents", width: 120 },
  { label: "Used by", width: 140 },
  { label: "Status", width: 120 },
];

/** A package id with its publisher muted, and the verified check. */
function PackageName({ id, verified }: { id: string; verified?: boolean }) {
  return (
    <>
      <span className="text-aomi-muted font-normal">
        {id.slice(0, id.indexOf("/") + 1)}
      </span>
      {shortName(id)}
      {verified ? <VerifiedCheck /> : null}
    </>
  );
}

function PackageList({ publisher }: { publisher: Publisher }) {
  const { packages } = publisher;
  const details = usePackages(packages.map((pkg) => pkg.id));
  const agents = useAgents(publisher.agents.map((agent) => agent.id));
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [query, setQuery] = useState("");
  const usedBy = (id: string) =>
    agents
      .filter((agent) => agent?.live?.config.packages.includes(id))
      .map((agent) => agent!.agent.display_name);
  const isLive = (pkg: Publisher["packages"][number]) =>
    packageStatus(pkg).tone === "success";
  const count = (name: (typeof FILTERS)[number]) =>
    packages.filter((pkg) =>
      name === "All" ? true : isLive(pkg) === (name === "Live"),
    ).length;
  const needle = query.trim().toLowerCase();
  const shown = packages
    .map((pkg, index) => ({ pkg, detail: details[index] }))
    .filter(
      ({ pkg }) =>
        (filter === "All" || isLive(pkg) === (filter === "Live")) &&
        (!needle || pkg.id.toLowerCase().includes(needle)),
    );
  // Packages of other publishers that this publisher's agents use. Their
  // details are not readable here: the manager serves only owned packages.
  const foreign = [
    ...new Set(
      agents.flatMap((agent) => agent?.live?.config.packages ?? []),
    ),
  ].filter((id) => !packages.some((pkg) => pkg.id === id));

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <label className="border-aomi-border bg-aomi-raised rounded-control flex h-9 min-w-60 flex-1 items-center gap-2 border px-3">
          <Search className="text-aomi-muted size-4 shrink-0" aria-hidden />
          <input
            aria-label="Search packages"
            placeholder="Search packages"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          />
        </label>
        <div
          role="tablist"
          aria-label="Filter packages"
          className="bg-aomi-surface-2 rounded-control inline-flex h-9 items-center gap-0.5 p-[3px]"
        >
          {FILTERS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={filter === name}
              onClick={() => setFilter(name)}
              className={`inline-flex h-full items-center gap-1.5 rounded-md px-3 text-[12px] font-medium ${filter === name ? "bg-aomi-raised text-aomi-fg ring-aomi-border ring-1" : "text-aomi-muted hover:text-aomi-fg"}`}
            >
              {name}
              <span className="font-normal">{count(name)}</span>
            </button>
          ))}
        </div>
      </div>
      <section className="flex flex-col gap-2">
        <ListGroup>
          <ListHeader title="Your packages" columns={PACKAGE_COLUMNS} chevron />
          {shown.length === 0 ? (
            <EmptyRow>
              {packages.length === 0 ? "No packages yet" : "No packages match"}
            </EmptyRow>
          ) : (
            shown.map(({ pkg, detail }) => {
              const status = packageStatus(pkg);
              const live = detail?.live;
              return (
                <Row
                  key={pkg.id}
                  leading={<PackageTile iconUrl={pkg.icon_url} />}
                  label={
                    <Link
                      href={`/packages/${shortName(pkg.id)}`}
                      className={ROW_LINK}
                    >
                      <PackageName id={pkg.id} verified={pkg.verified} />
                    </Link>
                  }
                  hint={detail?.package.description || null}
                >
                  <Cell width={112}>
                    {live ? (
                      <span className="text-[13px]">
                        {packageKind(live.tools.length)}
                      </span>
                    ) : null}
                  </Cell>
                  <Cell width={120}>
                    {live ? (
                      <span className="truncate text-[13px]">
                        {live.tools.length
                          ? `${plural(live.skills.length, "skill")} · ${plural(live.tools.length, "tool")}`
                          : plural(live.skills.length, "skill")}
                      </span>
                    ) : null}
                  </Cell>
                  <Cell width={140}>
                    <UsedBy names={usedBy(pkg.id)} />
                  </Cell>
                  <Cell width={120}>
                    <StatusPill
                      tone={status.tone}
                      dot={status.tone === "success"}
                    >
                      {status.label}
                    </StatusPill>
                  </Cell>
                  <RowChevron />
                </Row>
              );
            })
          )}
          {foreign.length ? (
            <ListHeader
              title="From other publishers, used by your agents"
              columns={[]}
            />
          ) : null}
          {foreign.map((id) => (
            <Row
              key={id}
              leading={<PackageTile />}
              label={<PackageName id={id} />}
            >
              <Cell width={112} />
              <Cell width={120} />
              <Cell width={140}>
                <UsedBy names={usedBy(id)} />
              </Cell>
              <Cell width={120} />
              <span className="w-4 shrink-0" />
            </Row>
          ))}
        </ListGroup>
      </section>
      <p className="type-meta text-aomi-muted text-center">
        Packages you list appear in the Library in Aomi Chat once they are
        live.
      </p>
    </>
  );
}

/** One of the publisher's two lists: its agents, or its packages. */
export function InventoryView({ only }: { only: "agents" | "packages" }) {
  const { data, error, isPending } = usePublisher();
  if (isPending)
    return <LoadingPanel label="Loading your agents and packages…" />;
  if (error) return <ErrorPanel message={error.message} />;
  return (
    <div className={pageFrame}>
      <PageHeader
        title={only === "agents" ? "Agents" : "Packages"}
        summary={
          <p>
            {only === "agents"
              ? "An agent is Aomi set up for your users: a voice, the packages it may use, wallet rules and the channels people reach it through. It holds no code."
              : "A package bundles skills, tools and guards. People turn it on in chat, and agents use it."}
          </p>
        }
        actions={
          only === "packages" ? (
            <Link href="/new" className={aomiButton({ variant: "primary" })}>
              <Plus />
              New package
            </Link>
          ) : null
        }
      />
      {only === "agents" ? (
        <AgentList publisher={data} />
      ) : (
        <PackageList publisher={data} />
      )}
    </div>
  );
}
