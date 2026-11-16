import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  ErrorPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";
import { createKey, fetchKeys, revokeKey } from "@/features/packages/client";
import { BUTTON, Card, Pill, Row, formatTime } from "@/features/packages/ui";

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
      <Row label="Copy this key now. It is not shown again." hint={create.data.label ?? undefined}>
        <code className="font-mono text-[12px] select-all">{create.data.key}</code>
      </Row>
    );
  return (
    <form
      className="flex items-center gap-2 px-4 py-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <input
        aria-label="Key name"
        placeholder="Key name, e.g. CI publish"
        className="border-border bg-background h-7 min-w-0 flex-1 rounded-md border px-2 text-[12px]"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
      />
      <button type="submit" className={BUTTON} disabled={create.isPending}>
        New builder key
      </button>
      {create.error ? (
        <span role="alert" className="text-destructive text-[12px]">
          {create.error.message}
        </span>
      ) : null}
    </form>
  );
}

/** Builder keys (CLI and CI) and access keys, which are not available yet. */
export function KeysView() {
  const queries = useQueryClient();
  const { data, error, isPending } = useQuery({ queryKey: KEYS, queryFn: fetchKeys });
  const revoke = useMutation({
    mutationFn: revokeKey,
    onSuccess: () => queries.invalidateQueries({ queryKey: KEYS }),
  });
  if (isPending) return <LoadingPanel label="Loading keys…" />;
  if (error) return <ErrorPanel message={error.message} />;
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div>
        <h1 className="text-foreground text-xl font-semibold">Keys</h1>
        <p className="text-dim text-[13px]">
          Builder keys are for the CLI and CI. Secrets a package&apos;s tools need are set on the
          package.
        </p>
      </div>
      <Card
        title="Builder keys"
        footer="A key can do only what its capabilities allow. Keys are not tied to an agent."
      >
        {data.keys.map((key) => (
          <Row
            key={key.id}
            label={key.label ?? "Unnamed key"}
            hint={`${key.prefix}… · ${
              key.lastUsedAt ? `last used ${formatTime(key.lastUsedAt)}` : `created ${formatTime(key.createdAt)}`
            } · ${key.capabilities.join(", ")}`}
          >
            {key.revokedAt ? (
              <Pill>Revoked</Pill>
            ) : (
              <>
                <Pill tone="good">Active</Pill>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(key.id)}
                >
                  Revoke
                </button>
              </>
            )}
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
