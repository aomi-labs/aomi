import { aomiButton, StatusPill } from "@aomi-labs/widget/host-composition";
import { useState } from "react";

import { LiveChanged, releaseLabel, type ReleaseKind } from "./client";
import { usePromote, useReleases } from "./hooks";
import { Card, Cell, EmptyRow, Mono, Row, formatTime } from "./ui";

/**
 * A package's releases or an agent's configs, newest first. Promote makes a
 * newer one live, Roll back an older one; both send the live number this list
 * read, so a pointer moved elsewhere is refused and said so.
 */
export function ReleaseHistory({
  kind,
  name,
}: {
  kind: ReleaseKind;
  name: string;
}) {
  const { data, error, isPending } = useReleases(kind, name);
  const promote = usePromote(kind, name);
  const [refusal, setRefusal] = useState<string | null>(null);
  const title = kind === "package" ? "Releases" : "Previous configs";

  if (isPending)
    return (
      <Card title={title}>
        <EmptyRow>Loading…</EmptyRow>
      </Card>
    );
  if (error)
    return (
      <Card title={title}>
        <EmptyRow>{error.message}</EmptyRow>
      </Card>
    );

  const run = (number: number) => {
    setRefusal(null);
    promote.mutate(
      { number, expectedLive: data.live },
      {
        onError: (failure) =>
          setRefusal(
            failure instanceof LiveChanged
              ? failure.message
              : `Not promoted: ${failure.message}`,
          ),
      },
    );
  };

  return (
    <Card
      title={title}
      origin="build"
      footer={
        refusal ? (
          <span role="alert" className="text-aomi-danger">
            {refusal}
          </span>
        ) : kind === "package" ? (
          "Each release is built by your CI and uploaded with aomi publish. Which one is live is set here."
        ) : (
          "Configs come from aomi.toml. Which one is live is set here."
        )
      }
    >
      {data.releases.length === 0 ? (
        <Row
          label="Nothing published yet"
          hint={`Run aomi publish --${kind} ${name}`}
        />
      ) : (
        data.releases.map((release) => (
          <Row
            key={release.number}
            label={<Mono>{releaseLabel(release)}</Mono>}
            hint={formatTime(release.created_at)}
          >
            <Cell width={132}>
              {release.number === data.live ? (
                <StatusPill tone="success" dot>
                  Live
                </StatusPill>
              ) : null}
            </Cell>
            <Cell width={96} end>
              {release.number === data.live ? null : (
                <button
                  type="button"
                  className={aomiButton({ size: "sm" })}
                  disabled={promote.isPending}
                  onClick={() => run(release.number)}
                >
                  {data.live != null && release.number < data.live
                    ? "Roll back"
                    : "Promote"}
                </button>
              )}
            </Cell>
          </Row>
        ))
      )}
    </Card>
  );
}
