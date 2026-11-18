import { aomiButton, StatusPill } from "@aomi-labs/widget/host-composition";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  ErrorPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";
import { createKey, fetchKeys, revokeKey } from "@/features/packages/client";
import { PageHeader, pageFrame } from "@/components/control-plane/page";
import { Card, Cell, INPUT, Mono, Row, formatTime } from "@/features/packages/ui";

/** What a new builder key may do: publish and promote packages and agents, set package secrets. */
const CAPABILITIES = [
  "package:publish",
  "package:promote",
  "agent:publish",
  "agent:promote",
  "package:secrets",
] as const;

const KEYS = ["build", "keys"] as const;

function NewKey() {
  const queries = useQueryClient();
  const [label, setLabel] = useState("");
  const create = useMutation({
    mutationFn: () => createKey({ label, capabilities: [...CAPABILITIES] }),
    onSuccess: () => queries.invalidateQueries({ queryKey: KEYS }),
  });
  if (create.data)
    return (
      <Row
        label="Copy this key now. It is not shown again."
        hint={create.data.label ?? undefined}
      >
        <code className="select-all font-mono text-[11.5px]">
          {create.data.key}
        </code>
      </Row>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2 px-3.5 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <input
        aria-label="Key name"
        placeholder="Key name, e.g. CI publish"
        className={INPUT}
        value={label}
        onChange={(event) => setLabel(event.target.value)}
      />
      <button type="submit" className={aomiButton({ size: "sm" })} disabled={create.isPending}>
        New builder key
      </button>
      {create.error ? (
        <span role="alert" className="text-aomi-danger type-meta">
          {create.error.message}
        </span>
      ) : null}
    </form>
  );
}

/** Builder keys (CLI and CI) and access keys, which are not available yet. */
export function KeysView() {
  const queries = useQueryClient();
  const { data, error, isPending } = useQuery({
    queryKey: KEYS,
    queryFn: fetchKeys,
  });
  const revoke = useMutation({
    mutationFn: revokeKey,
    onSuccess: () => queries.invalidateQueries({ queryKey: KEYS }),
  });
  if (isPending) return <LoadingPanel label="Loading keys…" />;
  if (error) return <ErrorPanel message={error.message} />;
  return (
    <div className={pageFrame}>
      <PageHeader
        title="Keys"
        summary={
          <p>
            Builder keys are for the CLI and CI. Secrets a package&apos;s tools
            need are set on the package.
          </p>
        }
      />
      <Card
        title="Builder keys"
        count={data.keys.length}
        footer="A key can do only what its capabilities allow. Keys are not tied to an agent."
      >
        {data.keys.map((key) => (
          <Row
            key={key.id}
            label={key.label ?? "Unnamed key"}
            hint={
              <>
                <Mono>{key.prefix}…</Mono> ·{" "}
                {key.lastUsedAt
                  ? `last used ${formatTime(key.lastUsedAt)}`
                  : `created ${formatTime(key.createdAt)}`}{" "}
                · {key.capabilities.join(", ")}
              </>
            }
          >
            <Cell width={132}>
              {key.revokedAt ? (
                <StatusPill>Revoked</StatusPill>
              ) : (
                <StatusPill tone="success" dot>
                  Active
                </StatusPill>
              )}
            </Cell>
            <Cell width={96} end>
              {key.revokedAt ? null : (
                <button
                  type="button"
                  className={aomiButton({ size: "sm" })}
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(key.id)}
                >
                  Revoke
                </button>
              )}
            </Cell>
          </Row>
        ))}
        <NewKey />
      </Card>
      <Card title="Access keys">
        <Row
          label="Access keys are not available yet"
          hint="Codes that open a private package come later; until then a private package reaches no one but you."
        />
      </Card>
    </div>
  );
}
