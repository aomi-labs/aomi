import { UrlLink as Link } from "@/components/url-link";
import {
  ErrorPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";

import { shortName, type Publisher } from "./client";
import { usePublisher } from "./hooks";
import { Card, Pill, Row } from "./ui";

const AGENT_STATUS: Record<
  Publisher["agents"][number]["status"],
  { label: string; tone: "good" | "warn" | "muted" }
> = {
  active: { label: "Live", tone: "good" },
  inactive: { label: "Inactive", tone: "muted" },
  needs_rebuild: { label: "Needs a rebuild", tone: "warn" },
  retired: { label: "Retired", tone: "muted" },
};

export const agentStatus = (status: Publisher["agents"][number]["status"]) =>
  AGENT_STATUS[status] ?? AGENT_STATUS.inactive;

function AgentList({ agents }: { agents: Publisher["agents"] }) {
  return (
    <Card
      title="Agents"
      origin="repo"
      footer="An agent is added by an [[agents]] table in aomi.toml and published with aomi publish."
    >
      {agents.length === 0 ? (
        <Row label="No agents yet" />
      ) : (
        agents.map((agent) => {
          const status = agentStatus(agent.status);
          return (
            <Row
              key={agent.id}
              label={
                <Link href={`/agents/${shortName(agent.id)}`} className="font-medium hover:underline">
                  {agent.display_name}
                </Link>
              }
              hint={<span className="font-mono">{agent.id}</span>}
            >
              <span className="text-dim text-[12px]">
                {agent.live_config == null ? "No config live" : `Config #${agent.live_config}`}
              </span>
              <Pill tone={status.tone}>{status.label}</Pill>
            </Row>
          );
        })
      )}
    </Card>
  );
}

function PackageList({ packages }: { packages: Publisher["packages"] }) {
  return (
    <Card
      title="Packages"
      origin="repo"
      footer="A package is a folder listed in aomi.toml; aomi publish uploads a release."
    >
      {packages.length === 0 ? (
        <Row label="No packages yet" />
      ) : (
        packages.map((pkg) => (
          <Row
            key={pkg.id}
            label={
              <Link href={`/packages/${shortName(pkg.id)}`} className="font-medium hover:underline">
                {pkg.display_name}
              </Link>
            }
            hint={<span className="font-mono">{pkg.id}</span>}
          >
            <span className="text-dim text-[12px]">
              {pkg.live_release == null ? "No release live" : `Release #${pkg.live_release}`}
            </span>
            {pkg.verified ? <Pill tone="good">Verified</Pill> : null}
            <Pill>{pkg.listed ? "Listed" : "Private"}</Pill>
            {pkg.active ? null : <Pill tone="warn">Off</Pill>}
          </Row>
        ))
      )}
    </Card>
  );
}

/** One of the publisher's two lists: its agents, or its packages. */
export function InventoryView({ only }: { only: "agents" | "packages" }) {
  const { data, error, isPending } = usePublisher();
  if (isPending) return <LoadingPanel label="Loading your agents and packages…" />;
  if (error) return <ErrorPanel message={error.message} />;
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div>
        <h1 className="text-foreground text-xl font-semibold">
          {only === "agents" ? "Agents" : "Packages"}
        </h1>
        <p className="text-dim text-[13px]">
          Published by <span className="font-mono">{data.publisher}</span>. Configured in your
          repo&apos;s aomi.toml; Build shows them read-only.
        </p>
      </div>
      {only === "agents" ? (
        <AgentList agents={data.agents} />
      ) : (
        <PackageList packages={data.packages} />
      )}
    </div>
  );
}
