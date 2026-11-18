import { aomiButton, StatusPill } from "@aomi-labs/widget/host-composition";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { KeyRound } from "lucide-react";

import { UrlLink as Link } from "@/components/url-link";
import { modelKeysFetch } from "@/features/operate/client";
import {
  PROVIDERS,
  PROVIDER_LABELS,
  type ProvidersPayload,
} from "@/features/operate/providers-view";

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

/** The builder's model keys per provider; they are added and changed on Providers. */
function ModelKeys() {
  const { data } = useQuery({
    queryKey: ["build", "model-keys"],
    queryFn: () => modelKeysFetch<ProvidersPayload>(),
  });
  return (
    <Card
      title="Model keys"
      action={
        <span className="type-meta text-aomi-muted">
          Pay the model cost for people using your agents
        </span>
      }
      footer="With no model key, people pay from their own Aomi balance."
    >
      {PROVIDERS.map((provider) => {
        const key = data?.keys?.find((row) => row.provider === provider);
        return (
          <Row
            key={provider}
            leading={
              <span className="bg-aomi-surface-2 text-aomi-muted rounded-control flex size-8 shrink-0 items-center justify-center">
                <KeyRound className="size-4" aria-hidden />
              </span>
            }
            label={
              key?.label
                ? `${PROVIDER_LABELS[provider]} · ${key.label}`
                : PROVIDER_LABELS[provider]
            }
            hint={key ? <Mono>{key.keyPrefix}…</Mono> : "No key"}
          >
            <Cell width={132}>
              {key ? (
                <StatusPill tone="success" dot>
                  Active
                </StatusPill>
              ) : (
                <StatusPill>Not set</StatusPill>
              )}
            </Cell>
            <Cell width={96} end>
              <Link href="/providers" className={aomiButton({ size: "sm" })}>
                {key ? "Manage" : "Add key"}
              </Link>
            </Cell>
          </Row>
        );
      })}
    </Card>
  );
}

/** Model keys, builder keys (CLI and CI) and access keys, which are not available yet. */
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
            Model keys pay for the model. Builder keys are for the CLI and CI.
            Access keys open private agents and packages. Secrets a
            package&apos;s tools need are set on the package.
          </p>
        }
      />
      <ModelKeys />
      <Card
        title="Builder keys"
        action={
          <span className="type-meta text-aomi-muted">
            For the CLI and CI. Capabilities: publish, promote, secrets.
          </span>
        }
        footer="A key can do only what its capabilities allow. Keys are not tied to an agent."
      >
        <div className="type-eyebrow text-aomi-muted bg-aomi-surface flex gap-3 px-3.5 py-2.5">
          <span className="flex-1">Name</span>
          <span className="w-[300px] shrink-0">Can do</span>
          <span className="w-[132px] shrink-0">Status</span>
          <span className="w-[96px] shrink-0" />
        </div>
        {data.keys.map((key) => (
          <Row
            key={key.id}
            label={key.label ?? "Unnamed key"}
            hint={
              <>
                <Mono>{key.prefix}…</Mono> ·{" "}
                {key.lastUsedAt
                  ? `last used ${formatTime(key.lastUsedAt)}`
                  : `created ${formatTime(key.createdAt)}`}
              </>
            }
          >
            <Cell width={300}>
              <span className="flex flex-wrap gap-1">
                {key.capabilities.map((capability) => (
                  <span
                    key={capability}
                    className="border-aomi-border bg-aomi-surface inline-flex h-6 items-center rounded-full border px-2 text-[12px]"
                  >
                    {capability}
                  </span>
                ))}
              </span>
            </Cell>
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
