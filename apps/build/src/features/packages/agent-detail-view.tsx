import { UrlLink as Link } from "@/components/url-link";
import {
  ErrorPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";

import { releaseLabel, shortName, type Agent } from "./client";
import { useAgent, usePublisher } from "./hooks";
import { agentStatus } from "./inventory-view";
import { ReleaseHistory } from "./release-history";
import {
  Card,
  Notice,
  PageHeader,
  Pill,
  Row,
  SourceStrip,
  formatTime,
} from "./ui";

type Config = NonNullable<Agent["live"]>["config"];

const CHANNEL_KIND: Record<string, string> = {
  telegram: "Telegram bot",
  widget: "Widget",
  page: "Page",
  api: "API",
};

function StatusNotice({ agent, name }: { agent: Agent; name: string }) {
  const { status } = agent.agent;
  if (status === "needs_rebuild")
    return (
      <Notice>
        Needs a rebuild: this agent was carried over from an app and its
        packages have no live release yet. Publish the packages and the agent
        from your repo with{" "}
        <code className="font-mono">aomi publish --agent {name}</code>, then
        promote them.
      </Notice>
    );
  if (status === "retired")
    return (
      <Notice>
        Retired: this agent no longer answers. Its history is kept.
      </Notice>
    );
  if (status === "inactive")
    return (
      <Notice>
        Inactive: no one can chat with this agent until it is turned on.
      </Notice>
    );
  if (!agent.live)
    return (
      <Notice>
        No config is live yet. Publish it with{" "}
        <code className="font-mono">aomi publish --agent {name}</code>, then
        promote it below.
      </Notice>
    );
  return null;
}

function ConfigCards({
  config,
  owned,
}: {
  config: Config;
  owned: Set<string>;
}) {
  const rules = config.wallet_rules;
  return (
    <>
      <Card title="Voice" origin="repo">
        <Row label="Name" hint={config.name}>
          <span className="text-foreground">{config.display_name}</span>
        </Row>
        <div className="text-foreground whitespace-pre-wrap px-4 py-2.5 text-[13px]">
          {config.voice ?? (
            <span className="text-dim">
              No voice written: it speaks as Aomi.
            </span>
          )}
        </div>
      </Card>
      <Card title="Packages" origin="repo">
        {config.packages.length === 0 ? (
          <Row label="No packages: Aomi's own tools only" />
        ) : (
          config.packages.map((id) => (
            <Row key={id} label={<span className="font-mono">{id}</span>}>
              {owned.has(id) ? (
                <Link
                  href={`/packages/${shortName(id)}`}
                  className="text-[12px] font-medium hover:underline"
                >
                  View package
                </Link>
              ) : null}
            </Row>
          ))
        )}
      </Card>
      <Card title="Chains and wallet rules" origin="repo">
        <Row label="Allowed chains" hint="Where the agent may trade">
          {config.chains.join(", ") || "None"}
        </Row>
        <Row label="Wallet" hint="Where people trade from">
          {rules.agent
            ? "A wallet made for this agent"
            : "The person's own wallets"}
        </Row>
        <Row label="Families">{rules.families.join(", ").toUpperCase()}</Row>
        <Row label="Approval" hint="When the agent must ask">
          {rules.ask_only || rules.default === "ask"
            ? "Ask every time"
            : "Instant by default"}
        </Row>
      </Card>
      <Card title="Reach and cost" origin="repo">
        <Row label="Audience">
          {config.audience === "public" ? "Anyone" : "Signed-in people"}
        </Row>
        <Row label="Allowed origins">
          {config.allowed_origins.length
            ? config.allowed_origins.join(", ")
            : "Any site"}
        </Row>
        <Row label="Model cost" hint="Chats are counted per agent">
          {config.model_cost === "builder"
            ? "You pay"
            : "Each person, from their own Aomi balance"}
        </Row>
        <Row label="Telegram groups">
          {config.telegram.group.enabled
            ? `On · ${config.telegram.group.tools.join(", ") || "no tools"}`
            : "Off"}
        </Row>
      </Card>
      {config.shortcuts.length ? (
        <Card title="Shortcuts" origin="repo">
          {config.shortcuts.map((shortcut) => (
            <Row
              key={shortcut.command}
              label={<span className="font-mono">/{shortcut.command}</span>}
            >
              <span className="text-dim font-mono text-[12px]">
                {shortcut.tool}
              </span>
            </Row>
          ))}
        </Card>
      ) : null}
    </>
  );
}

export function AgentDetailView({ name }: { name: string }) {
  const { data, error, isPending } = useAgent(name);
  const publisher = usePublisher();
  if (isPending) return <LoadingPanel label="Loading agent…" />;
  if (error) return <ErrorPanel message={error.message} />;
  const status = agentStatus(data.agent.status);
  const owned = new Set(publisher.data?.packages.map((pkg) => pkg.id) ?? []);
  const { live } = data;
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <PageHeader
        back={{ href: "/agents", label: "Agents" }}
        title={data.agent.display_name}
        badges={<Pill tone={status.tone}>{status.label}</Pill>}
        summary={
          live ? (
            <>
              <p className="text-dim text-[13px]">
                {live.config.packages.length} packages · {data.channels.length}{" "}
                channels · config{" "}
                <span className="font-mono">{releaseLabel(live)}</span> live
                since {formatTime(live.created_at)}
              </p>
              <SourceStrip repo={live.source_repo} commit={live.commit} />
            </>
          ) : null
        }
      />
      <StatusNotice agent={data} name={name} />
      {live ? <ConfigCards config={live.config} owned={owned} /> : null}
      <Card
        title="Channels"
        origin="build"
        footer="Each channel talks to this one agent. Tokens are set in Build; everything else comes from the file."
      >
        {data.channels.length === 0 ? (
          <Row label="No channels yet" />
        ) : (
          data.channels.map((channel) => (
            <Row
              key={channel.id}
              label={channel.external_bot_id}
              hint={`${CHANNEL_KIND[channel.kind] ?? channel.kind} · talks to ${data.agent.display_name}`}
            >
              <Pill tone={channel.live ? "good" : "muted"}>
                {channel.live ? "Active" : "Off"}
              </Pill>
            </Row>
          ))
        )}
      </Card>
      <ReleaseHistory kind="agent" name={name} />
    </div>
  );
}
