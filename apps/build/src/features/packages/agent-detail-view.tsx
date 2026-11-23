import { PackageTile, StatusPill } from "@aomi-labs/widget/host-composition";
import { UrlLink as Link } from "@/components/url-link";
import { pageFrame, pageTitle } from "@/components/control-plane/page";
import {
  ErrorPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";

import { Chains } from "./chains";
import { releaseLabel, shortName, type Agent } from "./client";
import { useAgent, usePackages, usePublisher } from "./hooks";
import { agentStatus } from "./inventory-view";
import { ReleaseHistory } from "./release-history";
import {
  AgentMark,
  Card,
  Cell,
  Columns,
  EmptyRow,
  Field,
  Mono,
  Notice,
  Row,
  SourceStrip,
  VerifiedCheck,
  formatTime,
  plural,
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
        Needs a rebuild: this agent was carried over from an earlier deployment
        and its packages have no live release yet. From your repo, publish and
        promote the packages first, then the agent:
        <ol className="mt-1.5 list-decimal pl-5">
          <li>
            <code className="font-mono">
              aomi build publish --promote --package &lt;package&gt;
            </code>{" "}
            for each package it lists
          </li>
          <li>
            <code className="font-mono">
              aomi build publish --promote --agent {name}
            </code>
          </li>
        </ol>
        Promoting the agent turns it back on.
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
        <code className="font-mono">aomi build publish --agent {name}</code>, then
        promote it below.
      </Notice>
    );
  return null;
}

/** The agent this one extends moved on: republishing takes its packages (D12). */
function BaseNotice({ agent, name }: { agent: Agent; name: string }) {
  const { base } = agent;
  if (!base || base.live === null || base.live === base.pinned) return null;
  return (
    <Notice>
      Built on <Mono>{base.agent}</Mono> config {base.pinned}; config{" "}
      {base.live} is live now. Republish to take its packages:{" "}
      <code className="font-mono">
        aomi build publish --promote --agent {name}
      </code>
    </Notice>
  );
}

function Voice({ config }: { config: Config }) {
  return (
    <Card title="Voice" origin="repo">
      <div className="flex flex-col gap-4 px-3.5 py-3.5">
        <div className="flex flex-col gap-1">
          <span className="type-meta text-aomi-muted font-medium">Name</span>
          <span className="text-[14px]">
            {config.display_name}{" "}
            <span className="text-aomi-muted">
              <Mono>{config.name}</Mono>
            </span>
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="type-meta text-aomi-muted font-medium">
            Instructions
          </span>
          <span className="whitespace-pre-wrap text-[14px] leading-5">
            {config.voice ?? (
              <span className="text-aomi-muted">
                No voice written: it speaks as Aomi.
              </span>
            )}
          </span>
        </div>
      </div>
    </Card>
  );
}

function Packages({ config, owned }: { config: Config; owned: Set<string> }) {
  // Only this publisher's packages are readable; others show their id.
  const details = usePackages(config.packages.filter((id) => owned.has(id)));
  const detail = (id: string) =>
    details.find((pkg) => pkg?.package.id === id);
  return (
    <Card title="Packages" count={config.packages.length} origin="repo">
      {config.packages.length === 0 ? (
        <EmptyRow>No packages: Aomi&apos;s own tools only</EmptyRow>
      ) : (
        config.packages.map((id) => (
          <Row
            key={id}
            leading={<PackageTile iconUrl={detail(id)?.package.icon_url} />}
            label={
              <>
                {id}
                {detail(id)?.verified ? <VerifiedCheck /> : null}
              </>
            }
            hint={(() => {
              const live = detail(id)?.live;
              return live
                ? `${plural(live.skills.length, "skill")} · ${plural(live.tools.length, "tool")}`
                : detail(id)?.package.description;
            })()}
          >
            <Cell width={132}>
              {detail(id)?.live ? (
                <StatusPill>
                  Live{" "}
                  {releaseLabel({
                    number: detail(id)!.live!.release,
                    digest: detail(id)!.live!.digest,
                  })}
                </StatusPill>
              ) : null}
            </Cell>
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
      <Card title="Chains" origin="repo">
        <Field label="Allowed chains" hint="Where the agent may trade">
          {config.chains.length ? <Chains chains={config.chains} /> : "None"}
        </Field>
      </Card>
      <Card title="Wallet rules" origin="repo">
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
        {config.audience === "public"
          ? "Anyone"
          : config.audience === "partner"
            ? "Through its partner's app"
            : "Signed-in people"}
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
      <div className="flex min-w-0 items-start gap-3.5">
        <AgentMark size={48} />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className={pageTitle}>{data.agent.display_name}</h1>
            <StatusPill tone={status.tone} dot={status.tone === "success"}>
              {status.label}
            </StatusPill>
          </div>
          {live ? (
            <>
              <p className="text-aomi-muted text-[14px]">
                {plural(live.config.packages.length, "package")} ·{" "}
                {plural(data.channels.length, "channel")} · config{" "}
                <Mono>{releaseLabel(live)}</Mono> live since{" "}
                {formatTime(live.created_at)}
              </p>
              <SourceStrip repo={live.source_repo} commit={live.commit} />
            </>
          ) : null}
        </div>
      </div>
      <StatusNotice agent={data} name={name} />
      <BaseNotice agent={data} name={name} />
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
