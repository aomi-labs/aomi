import { Package as PackageIcon } from "lucide-react";

import { UrlLink as Link } from "@/components/url-link";
import { PageHeader, pageFrame } from "@/components/control-plane/page";
import {
  ErrorPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";

import { shortName, type Publisher } from "./client";
import { usePublisher } from "./hooks";
import { Card, Cell, EmptyRow, Mono, Pill, Row, Tile, type Tone } from "./ui";

const AGENT_STATUS: Record<
  Publisher["agents"][number]["status"],
  { label: string; tone: Tone }
> = {
  active: { label: "Live", tone: "success" },
  inactive: { label: "Inactive", tone: "neutral" },
  needs_rebuild: { label: "Needs a rebuild", tone: "warning" },
  retired: { label: "Retired", tone: "neutral" },
};

export const agentStatus = (status: Publisher["agents"][number]["status"]) =>
  AGENT_STATUS[status] ?? AGENT_STATUS.inactive;

/** The row title's link covers the whole row. */
const ROW_LINK =
  "after:absolute after:inset-0 after:content-[''] hover:underline";

function AgentList({ agents }: { agents: Publisher["agents"] }) {
  return (
    <Card
      title="Agents"
      count={agents.length}
      origin="repo"
      footer="An agent is added by an [[agents]] table in aomi.toml and published with aomi publish."
    >
      {agents.length === 0 ? (
        <EmptyRow>No agents yet</EmptyRow>
      ) : (
        agents.map((agent) => {
          const status = agentStatus(agent.status);
          return (
            <Row
              key={agent.id}
              leading={
                <Tile round>{agent.display_name.charAt(0).toUpperCase()}</Tile>
              }
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
              <Cell width={120}>
                <span className="type-meta text-aomi-muted">
                  {agent.live_config == null
                    ? "No config live"
                    : `Config #${agent.live_config}`}
                </span>
              </Cell>
              <Cell width={132}>
                <Pill tone={status.tone} dot={status.tone === "success"}>
                  {status.label}
                </Pill>
              </Cell>
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
      count={packages.length}
      origin="repo"
      footer="A package is a folder listed in aomi.toml; aomi publish uploads a release. Packages you list appear in the Library in Aomi Chat once they are live."
    >
      {packages.length === 0 ? (
        <EmptyRow>No packages yet</EmptyRow>
      ) : (
        packages.map((pkg) => (
          <Row
            key={pkg.id}
            leading={
              <Tile>
                <PackageIcon />
              </Tile>
            }
            label={
              <Link
                href={`/packages/${shortName(pkg.id)}`}
                className={ROW_LINK}
              >
                {pkg.display_name}
              </Link>
            }
            hint={<Mono>{pkg.id}</Mono>}
          >
            <Cell width={96}>
              <span className="type-meta text-aomi-muted">
                {pkg.live_release == null
                  ? null
                  : `Release #${pkg.live_release}`}
              </span>
            </Cell>
            <Cell width={96}>
              <Pill>{pkg.listed ? "Listed" : "Private"}</Pill>
            </Cell>
            <Cell width={96}>
              {pkg.verified ? <Pill tone="accent">Verified</Pill> : null}
            </Cell>
            <Cell width={132}>
              {!pkg.active ? (
                <Pill tone="warning" dot>
                  Off
                </Pill>
              ) : pkg.live_release == null ? (
                <Pill>No release live</Pill>
              ) : (
                <Pill tone="success" dot>
                  Live
                </Pill>
              )}
            </Cell>
          </Row>
        ))
      )}
    </Card>
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
              ? "An agent is Aomi set up for your users: a voice, the packages it may use, wallet rules and the channels people reach it through."
              : "A package bundles skills, tools and guards. People turn it on in chat, and agents use it."}{" "}
            Published by <Mono>{data.publisher}</Mono> from your repo&apos;s
            aomi.toml; Build shows them read-only.
          </p>
        }
      />
      {only === "agents" ? (
        <AgentList agents={data.agents} />
      ) : (
        <PackageList packages={data.packages} />
      )}
    </div>
  );
}
