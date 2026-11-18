import {
  aomiButton,
  ListGroup,
  StatusPill,
  type StatusTone,
} from "@aomi-labs/widget/host-composition";
import { useState, type ReactNode } from "react";
import {
  ChevronRight,
  Code,
  Globe,
  Package as PackageIcon,
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

import { shortName, type Agent, type Publisher } from "./client";
import { useAgents, usePackages, usePublisher } from "./hooks";
import {
  PackageMark,
  Card,
  Cell,
  EmptyRow,
  Mono,
  Row,
  Tile,
  formatTime,
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

function Chip({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="border-aomi-border bg-aomi-surface inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border px-2 text-[12px] [&_svg]:text-aomi-muted [&_svg]:size-3">
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

const CHANNEL_ICON: Record<string, ReactNode> = {
  telegram: <Send aria-hidden />,
  widget: <Code aria-hidden />,
  page: <Globe aria-hidden />,
  sdk: <Terminal aria-hidden />,
  api: <Terminal aria-hidden />,
};

function CardRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-[13px]">
      <span className="text-aomi-muted w-[96px] shrink-0 leading-6">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 leading-6">
        {children}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  detail,
}: {
  agent: Publisher["agents"][number];
  detail: Agent | undefined;
}) {
  const status = agentStatus(agent.status);
  const config = detail?.live?.config;
  const rules = config?.wallet_rules;
  return (
    <div className="border-aomi-border bg-aomi-raised rounded-card flex flex-col gap-4 border p-5">
      <div className="flex items-start gap-3">
        <span className="bg-aomi-fg text-aomi-bg flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold">
          {agent.display_name.charAt(0).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[16px] font-semibold leading-[22px]">
            {agent.display_name}
          </span>
          <span className="text-aomi-muted">
            <Mono>{agent.id}</Mono>
          </span>
        </div>
        <StatusPill tone={status.tone} dot={status.tone === "success"}>
          {status.label}
        </StatusPill>
      </div>
      <div className="flex flex-col gap-2.5">
        <CardRow label="Channels">
          {detail?.channels.length ? (
            detail.channels.map((channel) => (
              <Chip key={channel.id} icon={CHANNEL_ICON[channel.kind]}>
                {channelLabel(channel.kind)} {channel.external_bot_id}
              </Chip>
            ))
          ) : (
            <span className="text-aomi-muted">No channels yet</span>
          )}
        </CardRow>
        <CardRow label="Packages">
          {config?.packages.length ? (
            config.packages.map((id) => (
              <Chip key={id} icon={<PackageIcon aria-hidden />}>
                {id}
              </Chip>
            ))
          ) : (
            <span className="text-aomi-muted">Aomi&apos;s own tools only</span>
          )}
        </CardRow>
        {rules ? (
          <CardRow label="Wallet rules">
            {[
              config.chains.join(", ") || null,
              rules.agent ? "a wallet made for this agent" : "the person's own wallets",
              rules.ask_only || rules.default === "ask"
                ? "asks before every trade"
                : "instant by default",
            ]
              .filter(Boolean)
              .join(" · ")}
          </CardRow>
        ) : null}
        {config ? (
          <CardRow label="Model cost">
            {config.model_cost === "builder"
              ? "You pay, from your builder credits"
              : "People pay from their own Aomi balance"}
          </CardRow>
        ) : null}
      </div>
      <div className="border-aomi-border mt-auto flex items-center justify-between gap-3 border-t pt-4">
        <span className="type-meta text-aomi-muted">
          {detail?.live
            ? `Config live since ${formatTime(detail.live.created_at)}`
            : "No config live"}
        </span>
        <Link
          href={`/agents/${shortName(agent.id)}`}
          className={aomiButton({ size: "sm" })}
        >
          View
        </Link>
      </div>
    </div>
  );
}

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
      <div className="grid gap-4 lg:grid-cols-2">
        {publisher.agents.map((agent, index) => (
          <AgentCard key={agent.id} agent={agent} detail={details[index]} />
        ))}
        <div className="border-aomi-border rounded-card flex flex-col gap-2 border border-dashed p-5">
          <span className="text-[16px] font-semibold leading-[22px]">
            Add an agent
          </span>
          <p className="type-control text-aomi-muted">
            An agent is added by an <Mono>[[agents]]</Mono> table in{" "}
            <Mono>aomi.toml</Mono>. Commit it and release; the agent shows up
            here. Build only holds channel tokens and which config is live.
          </p>
          <a
            href="https://aomi.dev/docs"
            target="_blank"
            rel="noreferrer"
            className="type-control mt-1 font-medium hover:underline"
          >
            How agents are configured
          </a>
        </div>
      </div>
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

function AgentChip({ name }: { name: string }) {
  return (
    <span className="border-aomi-border bg-aomi-surface inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border pl-1 pr-2 text-[12px]">
      <span className="bg-aomi-fg text-aomi-bg flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold">
        {name.charAt(0).toUpperCase()}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

const FILTERS = ["All", "Live", "Not live"] as const;

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
        <label className="border-aomi-border bg-aomi-surface rounded-control flex h-10 min-w-60 flex-1 items-center gap-2.5 border px-3.5">
          <Search className="text-aomi-muted size-4 shrink-0" aria-hidden />
          <input
            aria-label="Search packages"
            placeholder="Search packages"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
          />
        </label>
        <div
          role="tablist"
          aria-label="Filter packages"
          className="bg-aomi-surface-2 rounded-control inline-flex h-10 items-center gap-0.5 p-[3px]"
        >
          {FILTERS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={filter === name}
              onClick={() => setFilter(name)}
              className={`inline-flex h-full items-center gap-1.5 rounded-md px-[11px] text-[12px] font-medium ${filter === name ? "bg-aomi-raised text-aomi-fg ring-aomi-border ring-1" : "text-aomi-muted hover:text-aomi-fg"}`}
            >
              {name}
              <span className="font-normal">{count(name)}</span>
            </button>
          ))}
        </div>
      </div>
      <section className="flex flex-col gap-2">
        <ListGroup>
          {shown.length === 0 ? (
            <EmptyRow>
              {packages.length === 0 ? "No packages yet" : "No packages match"}
            </EmptyRow>
          ) : (
            shown.map(({ pkg, detail }) => {
              const status = packageStatus(pkg);
              const agentNames = usedBy(pkg.id);
              return (
                <Row
                  key={pkg.id}
                  leading={
                    <Tile>
                      <PackageMark id={pkg.id} />
                    </Tile>
                  }
                  label={
                    <Link
                      href={`/packages/${shortName(pkg.id)}`}
                      className={ROW_LINK}
                    >
                      <span className="text-aomi-muted font-normal">
                        {publisher.publisher}/
                      </span>
                      {shortName(pkg.id)}
                    </Link>
                  }
                  hint={detail?.package.description || null}
                >
                  <Cell width={140}>
                    {detail?.live ? (
                      <StatusPill>{packageKind(detail.live.tools.length)}</StatusPill>
                    ) : null}
                  </Cell>
                  <Cell width={140}>
                    <span className="type-meta text-aomi-muted">
                      {detail?.live
                        ? `${plural(detail.live.skills.length, "skill")} · ${plural(detail.live.tools.length, "tool")}`
                        : null}
                    </span>
                  </Cell>
                  <Cell width={144}>
                    {agentNames.length ? (
                      <AgentChip name={agentNames.join(", ")} />
                    ) : (
                      <span className="type-meta text-aomi-muted">
                        No agent yet
                      </span>
                    )}
                  </Cell>
                  <Cell width={96}>
                    {pkg.verified ? (
                      <StatusPill tone="accent">Verified</StatusPill>
                    ) : null}
                  </Cell>
                  <Cell width={132}>
                    <StatusPill tone={status.tone} dot>
                      {status.label}
                    </StatusPill>
                  </Cell>
                  <ChevronRight
                    className="text-aomi-muted size-4 shrink-0"
                    aria-hidden
                  />
                </Row>
              );
            })
          )}
        </ListGroup>
      </section>
      {foreign.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="type-eyebrow text-aomi-muted px-0.5 pt-2">
            From others, used by your agents
          </h2>
          <ListGroup>
            {foreign.map((id) => (
              <Row
                key={id}
                leading={
                  <span className="bg-aomi-surface-2 text-aomi-muted rounded-control flex size-8 shrink-0 items-center justify-center [&_svg]:size-4">
                    <PackageIcon />
                  </span>
                }
                label={
                  <>
                    <span className="text-aomi-muted font-normal">
                      {id.slice(0, id.indexOf("/") + 1)}
                    </span>
                    {shortName(id)}
                  </>
                }
              >
                <Cell width={144}>
                  <AgentChip name={usedBy(id).join(", ")} />
                </Cell>
              </Row>
            ))}
          </ListGroup>
        </section>
      ) : null}
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
