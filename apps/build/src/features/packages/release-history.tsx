import { useState } from "react";

import { LiveChanged, releaseLabel, type ReleaseKind } from "./client";
import { usePromote, useReleases } from "./hooks";
import { BUTTON, Card, Pill, Row, formatTime } from "./ui";

/**
 * A package's releases or an agent's configs, newest first. Promote makes a
 * newer one live, Roll back an older one; both send the live number this list
 * read, so a pointer moved elsewhere is refused and said so.
 */
export function ReleaseHistory({ kind, name }: { kind: ReleaseKind; name: string }) {
  const { data, error, isPending } = useReleases(kind, name);
  const promote = usePromote(kind, name);
  const [refusal, setRefusal] = useState<string | null>(null);
  const title = kind === "package" ? "Releases" : "Previous configs";

  if (isPending) return <Card title={title}><Row label="Loading…" /></Card>;
  if (error) return <Card title={title}><Row label={error.message} /></Card>;

  const run = (number: number) => {
    setRefusal(null);
    promote.mutate(
      { number, expectedLive: data.live },
      {
        onError: (failure) =>
          setRefusal(
            failure instanceof LiveChanged ? failure.message : `Not promoted: ${failure.message}`,
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
          <span role="alert" className="text-destructive">
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
        <Row label="Nothing published yet" hint={`Run aomi publish --${kind} ${name}`} />
      ) : (
        data.releases.map((release) => (
          <Row
            key={release.number}
            label={<span className="font-mono">{releaseLabel(release)}</span>}
            hint={formatTime(release.created_at)}
          >
            {release.number === data.live ? (
              <Pill tone="good">Live</Pill>
            ) : (
              <button
                type="button"
                className={BUTTON}
                disabled={promote.isPending}
                onClick={() => run(release.number)}
              >
                {data.live != null && release.number < data.live ? "Roll back" : "Promote"}
              </button>
            )}
          </Row>
        ))
      )}
    </Card>
  );
}
