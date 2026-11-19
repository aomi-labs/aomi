import {
  aomiButton,
  SectionHeader,
  PackageTile,
  StatusPill,
  type StatusTone,
} from "@aomi-labs/widget/host-composition";
import {
  ExternalLink,
  Github,
  Rocket,
  WandSparkles,
} from "lucide-react";
import { useState } from "react";

import { pageFrame, pageTitle } from "@/components/control-plane/page";

import {
  ErrorPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";

import { releaseLabel, shortName, type Package } from "./client";
import { usePackage, useSecret } from "./hooks";
import { IconCard } from "./icon-card";
import { ReleaseHistory } from "./release-history";
import {
  Card,
  Cell,
  Columns,
  EmptyRow,
  Field,
  INPUT,
  Mono,
  Notice,
  Row,
  VerifiedCheck,
  formatTime,
  packageKind,
  repoUrl,
} from "./ui";

type Slot = Package["slots"][number];

const SLOT_STATUS: Record<Slot["status"], { label: string; tone: StatusTone }> = {
  set: { label: "Set", tone: "success" },
  missing: { label: "Missing", tone: "warning" },
  users_add_their_own: { label: "Users add their own", tone: "neutral" },
};

/** One builder slot: Set or Missing, never its value. Replace or Add value types a new one. */
function SecretRow({ name, slot }: { name: string; slot: Slot }) {
  const secret = useSecret(name);
  const [value, setValue] = useState<string | null>(null);
  const status = SLOT_STATUS[slot.status];
  const builder = slot.owner === "builder";
  const save = () => {
    if (!value?.trim()) return;
    secret.mutate(
      { slot: slot.name, value },
      { onSuccess: () => setValue(null) },
    );
  };
  return (
    <div>
      <Row
        label={<Mono>{slot.name}</Mono>}
        hint={`${slot.description}${slot.required ? " · required" : ""}`}
      >
        <Cell width={104}>
          <span className="type-meta text-aomi-muted">
            {builder ? "Builder key" : "Each user"}
          </span>
        </Cell>
        <Cell width={132}>
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        </Cell>
        <Cell width={96} end>
          {builder && value == null ? (
            <button
              type="button"
              className={aomiButton({ size: "sm" })}
              onClick={() => setValue("")}
            >
              {slot.status === "set" ? "Replace" : "Add value"}
            </button>
          ) : null}
        </Cell>
      </Row>
      {value != null ? (
        <form
          className="flex flex-wrap items-center gap-2 px-3.5 pb-3"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <input
            type="password"
            autoComplete="off"
            aria-label={`New value for ${slot.name}`}
            className={`${INPUT} font-mono`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button
            type="submit"
            className={aomiButton({ size: "sm" })}
            disabled={secret.isPending || !value.trim()}
          >
            Save
          </button>
          <button
            type="button"
            className={aomiButton({ size: "sm" })}
            onClick={() => setValue(null)}
          >
            Cancel
          </button>
          {secret.error ? (
            <span role="alert" className="text-aomi-danger type-meta">
              {secret.error.message}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

const TABS = ["Overview", "Skills", "Tools", "Guards", "Secrets", "Releases"] as const;
type Tab = (typeof TABS)[number];

/** The repo, manifest path, commit and live release, one line under the title. */
function ReleaseStrip({ live }: { live: NonNullable<Package["live"]> }) {
  const dot = <span className="text-aomi-muted/60">·</span>;
  return (
    <div className="border-aomi-border bg-aomi-surface rounded-[12px] flex flex-wrap items-center gap-x-2 gap-y-1 border px-3.5 py-2.5 text-[12px]">
      <Github className="text-aomi-muted size-4 shrink-0" aria-hidden />
      {live.source_repo ? (
        <span className="font-medium">{live.source_repo}</span>
      ) : (
        <span className="text-aomi-muted">no source recorded</span>
      )}
      {dot}
      <Mono>aomi.toml</Mono>
      {live.commit ? (
        <>
          {dot}
          <span className="text-aomi-muted">
            commit <Mono>{live.commit.slice(0, 7)}</Mono>
          </span>
        </>
      ) : null}
      {dot}
      <span className="text-aomi-muted">
        Release{" "}
        <span className="text-aomi-fg">
          <Mono>{releaseLabel({ number: live.release, digest: live.digest })}</Mono>
        </span>{" "}
        · Uploaded {formatTime(live.created_at)}
      </span>
      {live.source_repo ? (
        <a
          href={`${repoUrl(live.source_repo)}/blob/${live.commit ?? "HEAD"}/aomi.toml`}
          target="_blank"
          rel="noreferrer"
          className="text-aomi-muted hover:text-aomi-fg ml-auto flex items-center gap-1"
        >
          View on GitHub
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

function SkillsCard({ live }: { live: NonNullable<Package["live"]> }) {
  return (
    <Card
      title="Skills"
      count={live.skills.length}
      origin="repo"
      footer="Opening any skill loads this package's tools. A skill does not list tools of its own."
    >
      {live.skills.length === 0 ? <EmptyRow>No skills</EmptyRow> : null}
      {live.skills.map((skill) => (
        <Row
          key={skill.id}
          leading={
            <span className="bg-aomi-surface-2 text-aomi-muted rounded-control flex size-8 shrink-0 items-center justify-center">
              <WandSparkles className="size-4" aria-hidden />
            </span>
          }
          label={<Mono>{skill.id}</Mono>}
          hint={skill.description}
        />
      ))}
    </Card>
  );
}

function ToolsCard({ live }: { live: NonNullable<Package["live"]> }) {
  return (
    <Card title="Tools" count={live.tools.length} origin="repo">
      {live.tools.length === 0 ? (
        <EmptyRow>No tools</EmptyRow>
      ) : (
        <div className="type-eyebrow text-aomi-muted bg-aomi-surface flex gap-3 px-3.5 py-2.5">
          <span className="flex-1">Tool</span>
          <span className="w-[160px] shrink-0">Audience</span>
        </div>
      )}
      {live.tools.map((tool) => (
        <div key={tool.name} className="flex min-h-11 items-center gap-3 px-3.5 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-[13px]">{tool.name}</span>
            {tool.description ? (
              <span className="type-meta text-aomi-muted block truncate">
                {tool.description}
              </span>
            ) : null}
          </span>
          <Cell width={160}>
            <StatusPill tone={tool.audience === "model" ? "neutral" : "accent"}>
              {tool.audience}
            </StatusPill>
          </Cell>
        </div>
      ))}
    </Card>
  );
}

function GuardsCards({ live }: { live: NonNullable<Package["live"]> }) {
  return (
    <>
      <Card title="Guards" origin="repo">
        <Field label="Transaction guards">{live.guards ? "Declared" : "None"}</Field>
        <Field
          label="Aomi checks"
          hint="Simulation, balance changes and approvals on every transaction"
        >
          Always on
        </Field>
      </Card>
      <Card
        title="Can reach"
        count={live.envelope.hosts.length}
        origin="repo"
        footer="The package's code can call only these hosts. Anything else is blocked."
      >
        {live.envelope.hosts.length === 0 ? (
          <EmptyRow>No hosts</EmptyRow>
        ) : (
          live.envelope.hosts.map((host) => (
            <Row key={host} label={<Mono>{host}</Mono>} />
          ))
        )}
      </Card>
    </>
  );
}

function SecretsCard({ data, name }: { data: Package; name: string }) {
  return (
    <Card
      title="Secrets"
      count={data.slots.length}
      origin="build"
      footer="The repo lists which secrets the package needs. Values are typed here and never shown again."
    >
      {data.slots.length === 0 ? (
        <EmptyRow>No secrets declared</EmptyRow>
      ) : (
        data.slots.map((slot) => (
          <SecretRow key={slot.name} name={name} slot={slot} />
        ))
      )}
    </Card>
  );
}

export function PackageDetailView({ name }: { name: string }) {
  const { data, error, isPending } = usePackage(name);
  const [tab, setTab] = useState<Tab>("Overview");
  if (isPending) return <LoadingPanel label="Loading package…" />;
  if (error) return <ErrorPanel message={error.message} />;
  const { live } = data;
  const publisher = data.package.id.slice(0, data.package.id.indexOf("/"));
  const count: Partial<Record<Tab, number>> = live
    ? { Skills: live.skills.length, Tools: live.tools.length }
    : {};
  return (
    <div className={pageFrame}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <PackageTile iconUrl={data.package.icon_url} size="detail" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={pageTitle}>{shortName(data.package.id)}</h1>
              {data.verified ? <VerifiedCheck /> : null}
              {live ? (
                <StatusPill tone="success" dot>
                  Live
                </StatusPill>
              ) : (
                <StatusPill>No release live</StatusPill>
              )}
              {live ? <StatusPill>{packageKind(live.tools.length)}</StatusPill> : null}
            </div>
            <p className="text-aomi-muted text-[14px]">
              {data.package.description}
              {data.package.description ? " " : ""}Published by {publisher}.
            </p>
          </div>
        </div>
        <button
          type="button"
          className={aomiButton({ variant: "primary" })}
          onClick={() => setTab("Releases")}
        >
          <Rocket />
          Releases
        </button>
      </div>
      {live ? (
        <ReleaseStrip live={live} />
      ) : (
        <Notice>
          No release is live. Publish one with{" "}
          <code className="font-mono">aomi publish --package {name}</code> and
          promote it under Releases.
        </Notice>
      )}
      <div
        role="tablist"
        aria-label="Package sections"
        className="bg-aomi-surface-2 rounded-control inline-flex flex-wrap gap-0.5 self-start p-[3px]"
      >
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={`inline-flex h-[26px] items-center gap-1.5 rounded-md px-[11px] text-[12px] font-medium ${tab === name ? "bg-aomi-raised text-aomi-fg ring-aomi-border ring-1" : "text-aomi-muted hover:text-aomi-fg"}`}
          >
            {name}
            {count[name] !== undefined ? (
              <span className="font-normal">{count[name]}</span>
            ) : null}
          </button>
        ))}
      </div>
      {tab === "Overview" ? (
        <Columns
          main={
            live ? (
              <>
                <SkillsCard live={live} />
                <ToolsCard live={live} />
              </>
            ) : (
              <SecretsCard data={data} name={name} />
            )
          }
          side={
            <>
              {live ? (
                <>
                  <Card title="Status">
                    <Field label="Release">
                      <Mono>
                        {releaseLabel({ number: live.release, digest: live.digest })}
                      </Mono>
                    </Field>
                    <Field label="Uploaded">{formatTime(live.created_at)}</Field>
                    <Field label="Runs in">Sandbox</Field>
                  </Card>
                  <Notice>One file runs on every host. Built for the sandbox.</Notice>
                </>
              ) : null}
              <IconCard iconUrl={data.package.icon_url} />
              <section className="flex flex-col gap-2">
                <SectionHeader as="h2" title="Access" />
                <div className="border-aomi-border bg-aomi-raised rounded-card flex flex-col items-start gap-2 border px-3.5 py-3 text-[13px]">
                  <StatusPill tone={data.verified ? "accent" : "neutral"}>
                    {data.verified ? "Verified" : "Not verified"}
                  </StatusPill>
                  <span>
                    {data.package.listed
                      ? "People turn it on in the Library."
                      : "Private: only you can use it."}
                  </span>
                  <span>
                    {data.package.listed ? "Listed in the Library" : "Private"}
                    <span className="text-aomi-muted"> · from the repo</span>
                  </span>
                  {data.package.active ? null : (
                    <StatusPill tone="warning">Off</StatusPill>
                  )}
                </div>
              </section>
            </>
          }
        />
      ) : null}
      {tab === "Skills" && live ? <SkillsCard live={live} /> : null}
      {tab === "Tools" && live ? <ToolsCard live={live} /> : null}
      {tab === "Guards" && live ? <GuardsCards live={live} /> : null}
      {tab === "Secrets" ? <SecretsCard data={data} name={name} /> : null}
      {tab === "Releases" ? <ReleaseHistory kind="package" name={name} /> : null}
    </div>
  );
}
