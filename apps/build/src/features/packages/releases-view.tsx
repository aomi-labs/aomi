import { useState } from "react";
import { Github, RefreshCw, Search } from "lucide-react";
import {
  aomiButton,
  ListGroup,
  PackageTile,
  StatusPill,
} from "@aomi-labs/widget/host-composition";

import { PageHeader, pageFrame } from "@/components/control-plane/page";
import { Select } from "@/components/select";
import {
  ErrorPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";

import { LiveChanged, releaseLabel, shortName, type Source } from "./client";
import {
  useAgents,
  useAllReleases,
  usePackages,
  usePromote,
  usePublisher,
  type ReleaseEntry,
} from "./hooks";
import {
  AgentMark,
  Cell,
  EmptyRow,
  ListHeader,
  Mono,
  Row,
  plural,
  repoUrl,
} from "./ui";

const COLUMNS = [
  { label: "Source", width: 220 },
  { label: "Uploaded", width: 120 },
  { label: "Status", width: 96 },
  { width: 104 },
];

/** `365 KB`, `2.1 MB`. */
function sizeLabel(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const uploaded = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** The repo and commit a live release was published from, when it recorded them. */
function SourceCell({ source }: { source: Source | null | undefined }) {
  if (!source?.source_repo) return null;
  const repo = source.source_repo.replace(/^https?:\/\/github\.com\//, "");
  return (
    <a
      href={`${repoUrl(source.source_repo)}${source.commit ? `/commit/${source.commit}` : ""}`}
      target="_blank"
      rel="noreferrer"
      className="relative flex min-w-0 items-center gap-1.5 text-[12px] hover:underline"
    >
      <Github className="text-aomi-muted size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{repo.slice(repo.indexOf("/") + 1)}</span>
      {source.commit ? (
        <span className="text-aomi-muted">
          <Mono>{source.commit.slice(0, 7)}</Mono>
        </span>
      ) : null}
    </a>
  );
}

const DOT = {
  current: <span aria-hidden className="bg-aomi-success size-1.5 rounded-full" />,
  previous: <span aria-hidden className="bg-aomi-muted size-1.5 rounded-full" />,
};

/** Make one release live: Roll back for an older number, Promote for a newer one. */
function PromoteButton({
  entry,
  onRefused,
}: {
  entry: ReleaseEntry;
  onRefused: (message: string) => void;
}) {
  const promote = usePromote(entry.kind, shortName(entry.id));
  const older =
    entry.liveNumber != null && entry.release.number < entry.liveNumber;
  return (
    <button
      type="button"
      className={aomiButton({ size: "sm" })}
      disabled={promote.isPending}
      onClick={() =>
        promote.mutate(
          { number: entry.release.number, expectedLive: entry.liveNumber },
          {
            onError: (failure) =>
              onRefused(
                failure instanceof LiveChanged
                  ? failure.message
                  : `Not promoted: ${failure.message}`,
              ),
          },
        )
      }
    >
      {older ? "Roll back" : "Promote"}
    </button>
  );
}

/** Every release and agent config the publisher owns, newest first. */
export function ReleasesView() {
  const publisher = usePublisher();
  const releases = useAllReleases(publisher.data);
  const packages = usePackages(publisher.data?.packages.map((pkg) => pkg.id) ?? []);
  const agents = useAgents(publisher.data?.agents.map((agent) => agent.id) ?? []);
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState<"" | "current" | "previous">("");
  const [query, setQuery] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  if (publisher.isPending) return <LoadingPanel label="Loading releases…" />;
  if (publisher.error) return <ErrorPanel message={publisher.error.message} />;

  // Only the live release or config records where it came from.
  const liveSource = (entry: ReleaseEntry): Source | null | undefined =>
    entry.live
      ? entry.kind === "package"
        ? packages.find((pkg) => pkg?.package.id === entry.id)?.live
        : agents.find((agent) => agent?.agent.id === entry.id)?.live
      : null;
  const iconUrl = (id: string) =>
    publisher.data.packages.find((pkg) => pkg.id === id)?.icon_url;

  const needle = query.trim().toLowerCase().replace(/^#/, "");
  const ofOwner = releases.entries.filter(
    (entry) =>
      (!owner || `${entry.kind}:${entry.id}` === owner) &&
      (!needle ||
        String(entry.release.number) === needle ||
        entry.release.digest.replace(/^sha256:/, "").startsWith(needle)),
  );
  const shown = ofOwner.filter(
    (entry) => !status || entry.live === (status === "current"),
  );
  const current = ofOwner.filter((entry) => entry.live).length;

  return (
    <div className={pageFrame}>
      <PageHeader
        title="Releases"
        summary={
          <p>
            Each release is built by your own CI and uploaded. Promote one to
            make it current, or roll back to an older one.
          </p>
        }
        actions={
          <button
            type="button"
            className={aomiButton()}
            onClick={() => void releases.refetch()}
          >
            <RefreshCw />
            Refresh
          </button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <label className="border-aomi-border bg-aomi-raised rounded-control flex h-9 min-w-60 flex-1 items-center gap-2 border px-3">
          <Search className="text-aomi-muted size-4 shrink-0" aria-hidden />
          <input
            aria-label="Search by number or digest"
            placeholder="Search by number or digest"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          />
        </label>
        <Select
          label="Showing"
          value={owner}
          onChange={setOwner}
          options={[
            { value: "", label: "Packages and agents" },
            ...publisher.data.packages.map((pkg) => ({
              value: `package:${pkg.id}`,
              label: shortName(pkg.id),
            })),
            ...publisher.data.agents.map((agent) => ({
              value: `agent:${agent.id}`,
              label: `${agent.display_name} config`,
            })),
          ]}
        />
        <Select
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: "All", count: ofOwner.length },
            {
              value: "current",
              label: "Current",
              count: current,
              leading: DOT.current,
            },
            {
              value: "previous",
              label: "Previous",
              count: ofOwner.length - current,
              leading: DOT.previous,
            },
          ]}
        />
      </div>
      <section className="flex flex-col gap-2">
        <ListGroup>
          <ListHeader title="Release" columns={COLUMNS} />
          {releases.error ? (
            <EmptyRow>{releases.error.message}</EmptyRow>
          ) : shown.length === 0 ? (
            <EmptyRow>
              {releases.pending ? "Loading…" : "No releases match"}
            </EmptyRow>
          ) : (
            shown.map((entry) => {
              const { release } = entry;
              return (
                <Row
                  key={`${entry.kind}:${entry.id}:${release.number}`}
                  leading={
                    entry.kind === "agent" ? (
                      <AgentMark />
                    ) : (
                      <PackageTile iconUrl={iconUrl(entry.id)} />
                    )
                  }
                  label={
                    <>
                      {entry.kind === "agent" ? entry.name : shortName(entry.id)}{" "}
                      <span className="text-aomi-muted ml-1 font-mono text-[11.5px] font-normal">
                        {entry.kind === "agent" ? "config " : ""}
                        {releaseLabel(release)}
                      </span>
                    </>
                  }
                  hint={
                    "size" in release
                      ? `Package · ${plural(release.tools.length, "tool")} · ${sizeLabel(release.size)}`
                      : "Agent config"
                  }
                >
                  <Cell width={220}>
                    <SourceCell source={liveSource(entry)} />
                  </Cell>
                  <Cell width={120}>
                    <span className="text-[13px]">
                      {uploaded(release.created_at)}
                    </span>
                  </Cell>
                  <Cell width={96}>
                    <StatusPill
                      tone={entry.live ? "success" : "neutral"}
                      dot={entry.live}
                    >
                      {entry.live ? "Current" : "Previous"}
                    </StatusPill>
                  </Cell>
                  <Cell width={104} end>
                    {entry.live ? null : (
                      <PromoteButton entry={entry} onRefused={setRefusal} />
                    )}
                  </Cell>
                </Row>
              );
            })
          )}
        </ListGroup>
        {refusal ? (
          <p role="alert" className="type-meta text-aomi-danger px-0.5">
            {refusal}
          </p>
        ) : null}
      </section>
    </div>
  );
}
