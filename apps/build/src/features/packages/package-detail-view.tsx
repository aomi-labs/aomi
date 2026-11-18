import { useState } from "react";

import { PageHeader, pageFrame } from "@/components/control-plane/page";

import {
  ErrorPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";

import { releaseLabel, type Package } from "./client";
import { usePackage, useSecret } from "./hooks";
import { ReleaseHistory } from "./release-history";
import {
  BUTTON,
  Card,
  EmptyRow,
  Cell,
  Columns,
  Field,
  INPUT,
  Mono,
  Notice,
  Pill,
  Row,
  SourceStrip,
  formatTime,
  type Tone,
} from "./ui";

type Slot = Package["slots"][number];

const SLOT_STATUS: Record<Slot["status"], { label: string; tone: Tone }> = {
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
          <Pill tone={status.tone}>{status.label}</Pill>
        </Cell>
        <Cell width={96} end>
          {builder && value == null ? (
            <button
              type="button"
              className={BUTTON}
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
            className={BUTTON}
            disabled={secret.isPending || !value.trim()}
          >
            Save
          </button>
          <button
            type="button"
            className={BUTTON}
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

export function PackageDetailView({ name }: { name: string }) {
  const { data, error, isPending } = usePackage(name);
  if (isPending) return <LoadingPanel label="Loading package…" />;
  if (error) return <ErrorPanel message={error.message} />;
  const { live } = data;
  return (
    <div className={pageFrame}>
      <PageHeader
        title={data.package.display_name}
        badges={
          <>
            {live ? (
              <Pill tone="success" dot>
                Live
              </Pill>
            ) : (
              <Pill>No release live</Pill>
            )}
            {data.verified ? <Pill tone="accent">Verified</Pill> : null}
          </>
        }
        summary={
          <>
            <p>
              {data.package.description} <Mono>{data.package.id}</Mono>
            </p>
            {live ? (
              <SourceStrip repo={live.source_repo} commit={live.commit} />
            ) : null}
          </>
        }
      />
      {live ? null : (
        <Notice>
          No release is live. Publish one with{" "}
          <code className="font-mono">aomi publish --package {name}</code> and
          promote it below.
        </Notice>
      )}
      <Columns
        main={
          <>
            {live ? (
              <>
                <Card
                  title="Skills"
                  count={live.skills.length}
                  origin="repo"
                  footer="Opening any skill loads this package's tools."
                >
                  {live.skills.length === 0 ? (
                    <EmptyRow>No skills</EmptyRow>
                  ) : null}
                  {live.skills.map((skill) => (
                    <Row
                      key={skill.id}
                      label={<Mono>{skill.id}</Mono>}
                      hint={skill.description}
                    />
                  ))}
                </Card>
                <Card title="Tools" count={live.tools.length} origin="repo">
                  {live.tools.length === 0 ? (
                    <EmptyRow>No tools</EmptyRow>
                  ) : null}
                  {live.tools.map((tool) => (
                    <Row
                      key={tool.name}
                      label={<Mono>{tool.name}</Mono>}
                      hint={tool.description}
                    >
                      <Cell width={132}>
                        <span className="type-meta text-aomi-muted">
                          {tool.audience}
                        </span>
                      </Cell>
                    </Row>
                  ))}
                </Card>
                <Card title="Guards" origin="repo">
                  <Field label="Transaction guards">
                    {live.guards ? "Declared" : "None"}
                  </Field>
                  <Field
                    label="Aomi checks"
                    hint="Simulation, balance changes and approvals on every transaction"
                  >
                    Always on
                  </Field>
                </Card>
              </>
            ) : null}
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
            {live ? (
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
            ) : null}
            <ReleaseHistory kind="package" name={name} />
          </>
        }
        side={
          <>
            {live ? (
              <Card title="Status">
                <Field label="Release">
                  <Mono>
                    {releaseLabel({
                      number: live.release,
                      digest: live.digest,
                    })}
                  </Mono>
                </Field>
                <Field label="Uploaded">{formatTime(live.created_at)}</Field>
                {live.commit ? (
                  <Field label="Commit">
                    <Mono>{live.commit.slice(0, 7)}</Mono>
                  </Field>
                ) : null}
              </Card>
            ) : null}
            <Card title="Access" origin="repo">
              <Field label="Library">
                {data.package.listed ? "Listed in the Library" : "Private"}
              </Field>
              {data.package.active ? null : (
                <Field label="State">
                  <Pill tone="warning">Off</Pill>
                </Field>
              )}
            </Card>
          </>
        }
      />
    </div>
  );
}
