import { aomiButton, StatusPill } from "@aomi-labs/widget/host-composition";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  fetchCodes,
  issueCode,
  removeGrant,
  revokeCode,
  shortName,
  type ActivationCode,
} from "@/features/packages/client";
import { usePublisher } from "@/features/packages/hooks";
import {
  Card,
  Cell,
  EmptyRow,
  INPUT,
  Mono,
  Row,
  formatTime,
} from "@/features/packages/ui";

const codesKey = (name: string) => ["build", "codes", name] as const;

type Private = { id: string; label: string };

function NewCode({ packages }: { packages: Private[] }) {
  const queries = useQueryClient();
  const [id, setId] = useState(packages[0]?.id ?? "");
  const [agent, setAgent] = useState("");
  const issue = useMutation({
    mutationFn: () => issueCode(shortName(id), agent.trim() || undefined),
    onSuccess: () =>
      queries.invalidateQueries({ queryKey: codesKey(shortName(id)) }),
  });
  if (issue.data)
    return (
      <Row
        label="Copy this code now. It is not shown again."
        hint={`Opens ${issue.data.package} for ${issue.data.agent ?? "anyone who adds it"}`}
      >
        <code className="select-all font-mono text-[11.5px]">
          {issue.data.code}
        </code>
      </Row>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2 px-3.5 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        issue.mutate();
      }}
    >
      <select
        aria-label="Package"
        className={INPUT}
        value={id}
        onChange={(event) => setId(event.target.value)}
      >
        {packages.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <input
        aria-label="Agent"
        placeholder="For one agent (optional), e.g. alice/bot"
        className={INPUT}
        value={agent}
        onChange={(event) => setAgent(event.target.value)}
      />
      <button
        type="submit"
        className={aomiButton({ size: "sm" })}
        disabled={issue.isPending || !id}
      >
        New access key
      </button>
      {issue.error ? (
        <span role="alert" className="text-aomi-danger type-meta">
          {issue.error.message}
        </span>
      ) : null}
    </form>
  );
}

/** One code, and under it everyone who holds the package through it. */
function Code({
  pkg,
  code,
  onRevoke,
  onRemove,
  busy,
}: {
  pkg: Private;
  code: ActivationCode;
  onRevoke: () => void;
  onRemove: (grant: number) => void;
  busy: boolean;
}) {
  const holders = code.revoked_at
    ? []
    : code.grants.filter((grant) => !grant.revoked_at);
  return (
    <>
      <Row
        label={pkg.label}
        hint={
          <>
            <Mono>#{code.id}</Mono> · for {code.agent ?? "anyone who adds it"} ·
            created {formatTime(code.created_at)}
          </>
        }
      >
        <Cell width={120}>
          {holders.length} {holders.length === 1 ? "holder" : "holders"}
        </Cell>
        <Cell width={112}>
          {code.revoked_at ? (
            <StatusPill>Revoked</StatusPill>
          ) : (
            <StatusPill tone="success" dot>
              Active
            </StatusPill>
          )}
        </Cell>
        <Cell width={96} end>
          {code.revoked_at ? null : (
            <button
              type="button"
              className={aomiButton({ size: "sm" })}
              disabled={busy}
              onClick={onRevoke}
            >
              Revoke
            </button>
          )}
        </Cell>
      </Row>
      {holders.map((grant) => (
        <Row
          key={grant.id}
          leading={<span className="w-8 shrink-0" />}
          label={
            grant.agent ? (
              <>
                Agent <Mono>{grant.agent}</Mono>
              </>
            ) : (
              <>
                Person <Mono>{grant.account?.slice(0, 8)}</Mono>
              </>
            )
          }
          hint={`Added ${formatTime(grant.created_at)}`}
        >
          <Cell width={96} end>
            <button
              type="button"
              className={aomiButton({ size: "sm" })}
              disabled={busy}
              onClick={() => onRemove(grant.id)}
            >
              Remove
            </button>
          </Cell>
        </Row>
      ))}
    </>
  );
}

/**
 * Codes that open a private package: made here, given to people (who add the
 * package with Add with code in the Aomi Chat Library) or to one agent.
 */
export function AccessKeys() {
  const queries = useQueryClient();
  const { data: publisher } = usePublisher();
  const packages: Private[] = (publisher?.packages ?? [])
    .filter((pkg) => !pkg.listed)
    .map((pkg) => ({ id: pkg.id, label: pkg.display_name || pkg.id }));
  const codes = useQueries({
    queries: packages.map((pkg) => ({
      queryKey: codesKey(shortName(pkg.id)),
      queryFn: () => fetchCodes(shortName(pkg.id)),
    })),
  });
  const refresh = (pkg: Private) =>
    queries.invalidateQueries({ queryKey: codesKey(shortName(pkg.id)) });
  const revoke = useMutation({
    mutationFn: ({ pkg, id }: { pkg: Private; id: number }) =>
      revokeCode(shortName(pkg.id), id),
    onSuccess: (_, { pkg }) => refresh(pkg),
  });
  const remove = useMutation({
    mutationFn: ({ pkg, id }: { pkg: Private; id: number }) =>
      removeGrant(shortName(pkg.id), id),
    onSuccess: (_, { pkg }) => refresh(pkg),
  });
  const error = revoke.error ?? remove.error;
  return (
    <Card
      title="Access keys"
      action={
        <span className="type-meta text-aomi-muted">
          Codes that open a private package
        </span>
      }
      footer="People add the package with Add with code in the Aomi Chat Library. Revoking a code ends it for everyone who used it."
    >
      {packages.length === 0 ? (
        <EmptyRow>
          Every package you publish is listed in the Library, so none needs a
          code. A package that is not listed is private: codes open it.
        </EmptyRow>
      ) : (
        <>
          {packages.flatMap((pkg, index) =>
            (codes[index]?.data?.codes ?? []).map((code) => (
              <Code
                key={code.id}
                pkg={pkg}
                code={code}
                busy={revoke.isPending || remove.isPending}
                onRevoke={() => revoke.mutate({ pkg, id: code.id })}
                onRemove={(id) => remove.mutate({ pkg, id })}
              />
            )),
          )}
          {error ? (
            <EmptyRow>
              <span role="alert" className="text-aomi-danger">
                {error.message}
              </span>
            </EmptyRow>
          ) : null}
          <NewCode packages={packages} />
        </>
      )}
    </Card>
  );
}
