import { useState } from "react";

import {
  ErrorPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";

import { releaseLabel, type Package } from "./client";
import { usePackage, useSecret } from "./hooks";
import { ReleaseHistory } from "./release-history";
import { BUTTON, Card, Notice, PageHeader, Pill, Row, SourceStrip, formatTime } from "./ui";

type Slot = Package["slots"][number];

const SLOT_STATUS: Record<Slot["status"], { label: string; tone: "good" | "warn" | "muted" }> = {
  set: { label: "Set", tone: "good" },
  missing: { label: "Missing", tone: "warn" },
  users_add_their_own: { label: "Users add their own", tone: "muted" },
};

/** One builder slot: Set or Missing, never its value. Replace or Add value types a new one. */
function SecretRow({ name, slot }: { name: string; slot: Slot }) {
  const secret = useSecret(name);
  const [value, setValue] = useState<string | null>(null);
  const status = SLOT_STATUS[slot.status];
  const builder = slot.owner === "builder";
  const save = () => {
    if (!value?.trim()) return;
    secret.mutate({ slot: slot.name, value }, { onSuccess: () => setValue(null) });
  };
  return (
    <div>
      <Row
        label={<span className="font-mono">{slot.name}</span>}
        hint={`${slot.description}${slot.required ? " · required" : ""} · ${builder ? "Builder key" : "Each user"}`}
      >
        <Pill tone={status.tone}>{status.label}</Pill>
        {builder && value == null ? (
          <button type="button" className={BUTTON} onClick={() => setValue("")}>
            {slot.status === "set" ? "Replace" : "Add value"}
          </button>
        ) : null}
      </Row>
      {value != null ? (
        <form
          className="flex items-center gap-2 px-4 pb-3"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <input
            type="password"
            autoComplete="off"
            aria-label={`New value for ${slot.name}`}
            className="border-border bg-background h-7 min-w-0 flex-1 rounded-md border px-2 font-mono text-[12px]"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="submit" className={BUTTON} disabled={secret.isPending || !value.trim()}>
            Save
          </button>
          <button type="button" className={BUTTON} onClick={() => setValue(null)}>
            Cancel
          </button>
          {secret.error ? (
            <span role="alert" className="text-destructive text-[12px]">
              {secret.error.message}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

export function PackageDetailView({ name }: { name: string }) {
  const { data, error, isPending } = usePackage(name);
  if (isPending) return <LoadingPanel label="Loading package…" />;
  if (error) return <ErrorPanel message={error.message} />;
  const { live } = data;
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <PageHeader
        back={{ href: "/packages", label: "Packages" }}
        title={data.package.id}
        badges={
          <>
            <Pill tone={live ? "good" : "muted"}>{live ? "Live" : "No release live"}</Pill>
            <Pill tone={data.verified ? "good" : "muted"}>
              {data.verified ? "Verified" : "Not verified"}
            </Pill>
          </>
        }
        summary={
          <>
            <p className="text-dim text-[13px]">{data.package.description}</p>
            {live ? (
              <p className="text-dim text-[13px]">
                Release <span className="text-foreground font-mono">{releaseLabel({ number: live.release, digest: live.digest })}</span>{" "}
                · uploaded {formatTime(live.created_at)}
              </p>
            ) : null}
            {live ? <SourceStrip repo={live.source_repo} commit={live.commit} /> : null}
          </>
        }
      />
      {live ? null : (
        <Notice>
          No release is live. Publish one with{" "}
          <code className="font-mono">aomi publish --package {name}</code> and promote it below.
        </Notice>
      )}
      {live ? (
        <>
          <Card
            title={`Skills · ${live.skills.length}`}
            origin="repo"
            footer="Opening any skill loads this package's tools."
          >
            {live.skills.map((skill) => (
              <Row key={skill.id} label={<span className="font-mono">{skill.id}</span>} hint={skill.description} />
            ))}
          </Card>
          <Card title={`Tools · ${live.tools.length}`} origin="repo">
            {live.tools.map((tool) => (
              <Row key={tool.name} label={<span className="font-mono">{tool.name}</span>} hint={tool.description}>
                <span className="text-dim text-[12px]">{tool.audience}</span>
              </Row>
            ))}
          </Card>
          <Card title="Guards" origin="repo">
            <Row label="Transaction guards">{live.guards ? "Declared" : "None"}</Row>
            <Row label="Aomi checks" hint="Simulation, balance changes and approvals on every transaction">
              Always on
            </Row>
          </Card>
        </>
      ) : null}
      <Card
        title={`Secrets · ${data.slots.length}`}
        origin="build"
        footer="The repo lists which secrets the package needs. Values are typed here and never shown again."
      >
        {data.slots.length === 0 ? (
          <Row label="No secrets declared" />
        ) : (
          data.slots.map((slot) => <SecretRow key={slot.name} name={name} slot={slot} />)
        )}
      </Card>
      {live ? (
        <Card
          title={`Can reach · ${live.envelope.hosts.length}`}
          origin="repo"
          footer="The package's code can call only these hosts. Anything else is blocked."
        >
          {live.envelope.hosts.length === 0 ? (
            <Row label="No hosts" />
          ) : (
            live.envelope.hosts.map((host) => <Row key={host} label={<span className="font-mono">{host}</span>} />)
          )}
        </Card>
      ) : null}
      <Card title="Access" origin="repo">
        <Row label={data.package.listed ? "Listed in the Library" : "Private"}>
          {data.package.active ? null : <Pill tone="warn">Off</Pill>}
        </Row>
      </Card>
      <ReleaseHistory kind="package" name={name} />
    </div>
  );
}
