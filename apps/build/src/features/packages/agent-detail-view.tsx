import { StatusPill } from "@aomi-labs/widget/host-composition";
import { UrlLink as Link } from "@/components/url-link";
import { PageHeader, pageFrame } from "@/components/control-plane/page";
import {
  ErrorPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";

import { releaseLabel, shortName, type Agent } from "./client";
import { useAgent, usePublisher } from "./hooks";
import { agentStatus } from "./inventory-view";
import { ReleaseHistory } from "./release-history";
import { Card, EmptyRow, Cell, Columns, Field, Mono, Notice, Row, SourceStrip, Tile, formatTime } from "./ui";

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
        Needs a rebuild: this agent was carried over from an earlier deployment
        and its packages have no live release yet. Publish the packages and the
        agent from your repo with{" "}
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

function Voice({ config }: { config: Config }) {
  return (
    <Card title="Voice" origin="repo">
      <Field label="Name" hint={config.name}>
        {config.display_name}
      </Field>
      <div className="whitespace-pre-wrap px-3.5 py-2.5 text-[13px] leading-5">
        {config.voice ?? (
          <span className="text-aomi-muted">
            No voice written: it speaks as Aomi.
          </span>
        )}
      </div>
    </Card>
  );
}

function Packages({ config, owned }: { config: Config; owned: Set<string> }) {
  return (
    <Card title="Packages" count={config.packages.length} origin="repo">
      {config.packages.length === 0 ? (
        <EmptyRow>No packages: Aomi&apos;s own tools only</EmptyRow>
      ) : (
        config.packages.map((id) => (
          <Row key={id} label={<Mono>{id}</Mono>}>
            <Cell width={96} end>
              {owned.has(id) ? (
                <Link
                  href={`/packages/${shortName(id)}`}
                  className="text-aomi-muted hover:text-aomi-fg type-meta font-medium"
                >
                  View package
                </Link>
              ) : null}
            </Cell>
          </Row>
        ))
      )}
    </Card>
  );
}

function Rules({ config }: { config: Config }) {
  const rules = config.wallet_rules;
  return (
    <>
      <Card title="Chains and wallet rules" origin="repo">
        <Field label="Allowed chains" hint="Where the agent may trade">
          {config.chains.join(", ") || "None"}
        </Field>
        <Field label="Wallet" hint="Where people trade from">
          {rules.agent
            ? "A wallet made for this agent"
            : "The person's own wallets"}
        </Field>
        <Field label="Families">
          {rules.families.join(", ").toUpperCase()}
        </Field>
        <Field label="Approval" hint="When the agent must ask">
          {rules.ask_only || rules.default === "ask"
            ? "Ask every time"
            : "Instant by default"}
        </Field>
      </Card>
      {config.shortcuts.length ? (
        <Card title="Shortcuts" count={config.shortcuts.length} origin="repo">
          {config.shortcuts.map((shortcut) => (
            <Row
              key={shortcut.command}
              label={<Mono>/{shortcut.command}</Mono>}
              hint={<Mono>{shortcut.tool}</Mono>}
            />
          ))}
        </Card>
      ) : null}
    </>
  );
}

function Reach({ config }: { config: Config }) {
  return (
    <Card title="Reach and cost" origin="repo">
      <Field label="Audience">
        {config.audience === "public" ? "Anyone" : "Signed-in people"}
      </Field>
      <Field label="Allowed origins">
        {config.allowed_origins.length
          ? config.allowed_origins.join(", ")
          : "Any site"}
      </Field>
      <Field label="Model cost" hint="Chats are counted per agent">
        {config.model_cost === "builder"
          ? "You pay"
          : "Each person, from their own Aomi balance"}
      </Field>
      <Field label="Telegram groups">
        {config.telegram.group.enabled
          ? `On · ${config.telegram.group.tools.join(", ") || "no tools"}`
          : "Off"}
      </Field>
    </Card>
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
    <div className={pageFrame}>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Tile round>{data.agent.display_name.charAt(0).toUpperCase()}</Tile>
            {data.agent.display_name}
          </span>
        }
        badges={
          <StatusPill tone={status.tone} dot={status.tone === "success"}>
            {status.label}
          </StatusPill>
        }
        summary={
          live ? (
            <>
              <p>
                {live.config.packages.length} packages · {data.channels.length}{" "}
                channels · config <Mono>{releaseLabel(live)}</Mono> live since{" "}
                {formatTime(live.created_at)}
              </p>
              <SourceStrip repo={live.source_repo} commit={live.commit} />
            </>
          ) : null
        }
      />
      <StatusNotice agent={data} name={name} />
      <Columns
        main={
          <>
            {live ? (
              <>
                <Voice config={live.config} />
                <Packages config={live.config} owned={owned} />
                <Rules config={live.config} />
              </>
            ) : null}
            <Card
              title="Channels"
              count={data.channels.length}
              origin="build"
              footer="Each channel talks to this one agent. Tokens are set in Build; everything else comes from the file."
            >
              {data.channels.length === 0 ? (
                <EmptyRow>No channels yet</EmptyRow>
              ) : (
                data.channels.map((channel) => (
                  <Row
                    key={channel.id}
                    label={channel.external_bot_id}
                    hint={`${CHANNEL_KIND[channel.kind] ?? channel.kind} · talks to ${data.agent.display_name}`}
                  >
                    <Cell width={132}>
                      <StatusPill
                        tone={channel.live ? "success" : "neutral"}
                        dot={channel.live}
                      >
                        {channel.live ? "Active" : "Off"}
                      </StatusPill>
                    </Cell>
                  </Row>
                ))
              )}
            </Card>
            <ReleaseHistory kind="agent" name={name} />
          </>
        }
        side={live ? <Reach config={live.config} /> : null}
      />
    </div>
  );
}
