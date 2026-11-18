import { useState } from "react";
import { Bot, Package as PackageIcon, RefreshCw, Search } from "lucide-react";
import {
  aomiButton,
  ListGroup,
  StatusPill,
} from "@aomi-labs/widget/host-composition";

import { PageHeader, pageFrame } from "@/components/control-plane/page";
import {
  ErrorPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";

import { LiveChanged, releaseLabel, shortName } from "./client";
import {
  useAllReleases,
  usePromote,
  usePublisher,
  type ReleaseEntry,
} from "./hooks";
import { Cell, EmptyRow, Row, formatTime } from "./ui";

const SELECT = `${aomiButton()} appearance-none pr-8 bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")] bg-[position:right_10px_center] bg-no-repeat`;

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
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState<"" | "current" | "previous">("");
  const [query, setQuery] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  if (publisher.isPending) return <LoadingPanel label="Loading releases…" />;
  if (publisher.error) return <ErrorPanel message={publisher.error.message} />;

  const needle = query.trim().toLowerCase().replace(/^#/, "");
  const shown = releases.entries.filter(
    (entry) =>
      (!owner || `${entry.kind}:${entry.id}` === owner) &&
      (!status || entry.live === (status === "current")) &&
      (!needle ||
        String(entry.release.number) === needle ||
        entry.release.digest.replace(/^sha256:/, "").startsWith(needle)),
  );

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
        <select
          aria-label="Package or agent"
          className={SELECT}
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
        >
          <option value="">All packages and agents</option>
          {publisher.data.packages.map((pkg) => (
            <option key={pkg.id} value={`package:${pkg.id}`}>
              {shortName(pkg.id)}
            </option>
          ))}
          {publisher.data.agents.map((agent) => (
            <option key={agent.id} value={`agent:${agent.id}`}>
              {agent.display_name} config
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          className={SELECT}
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          <option value="">All statuses</option>
          <option value="current">Current</option>
          <option value="previous">Previous</option>
        </select>
        <label className="border-aomi-border bg-aomi-surface rounded-control flex h-10 min-w-60 flex-1 items-center gap-2.5 border px-3.5">
          <Search className="text-aomi-muted size-4 shrink-0" aria-hidden />
          <input
            aria-label="Search by number or digest"
            placeholder="Search by number or digest"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
          />
        </label>
      </div>
      <section className="flex flex-col gap-2">
        <ListGroup>
        {releases.error ? (
          <EmptyRow>{releases.error.message}</EmptyRow>
        ) : shown.length === 0 ? (
          <EmptyRow>
            {releases.pending ? "Loading…" : "No releases match"}
          </EmptyRow>
        ) : (
          shown.map((entry) => (
            <Row
              key={`${entry.kind}:${entry.id}:${entry.release.number}`}
              leading={
                <span
                  className={`rounded-control flex size-8 shrink-0 items-center justify-center [&_svg]:size-4 ${entry.live ? "bg-aomi-accent-subtle text-aomi-accent-strong" : "bg-aomi-surface-2 text-aomi-muted"}`}
                >
                  {entry.kind === "agent" ? <Bot /> : <PackageIcon />}
                </span>
              }
              label={
                <>
                  {entry.kind === "agent" ? entry.name : shortName(entry.id)}{" "}
                  <span className="text-aomi-muted ml-1 font-mono text-[11.5px] font-normal">
                    {entry.kind === "agent" ? "config " : ""}
                    {releaseLabel(entry.release)}
                  </span>
                </>
              }
              hint={formatTime(entry.release.created_at)}
            >
              <Cell width={132}>
                <StatusPill
                  tone={entry.live ? "success" : "neutral"}
                  dot={entry.live}
                >
                  {entry.live ? "Current" : "Previous"}
                </StatusPill>
              </Cell>
              <Cell width={96} end>
                {entry.live ? null : (
                  <PromoteButton entry={entry} onRefused={setRefusal} />
                )}
              </Cell>
            </Row>
          ))
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
