"use client";

import { useEffect, useState } from "react";
import {
  AomiCommits,
  CommitNotFoundError,
  type CommitHandle,
} from "@aomi-labs/client";
import {
  AomiSheet,
  CommitSignPanel,
  LoadingPane,
  SheetHeader,
} from "@aomi-labs/widget/host-composition";
import { createPortalClient } from "@/app/oauth/portal-client";
import { StandalonePage } from "@/components/shell/standalone-page";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; handle: CommitHandle }
  | { kind: "failed"; title: string; detail?: string };

const home = () => window.location.assign("/");

/** `/sign/:ref`: the wallet picker if needed, then the commit's review sheet. */
export function SignCommitClient({ commitRef }: { commitRef: string }) {
  return (
    <StandalonePage needsWallet purpose={{ text: "To review a trade" }}>
      <Review commitRef={commitRef} />
    </StandalonePage>
  );
}

function Review({ commitRef }: { commitRef: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let opened: CommitHandle | undefined;
    setState({ kind: "loading" });
    new AomiCommits(createPortalClient()).get(commitRef).then(
      (handle) => {
        if (cancelled) return handle.close();
        opened = handle;
        setState({ kind: "ready", handle });
      },
      (error: unknown) => {
        if (cancelled) return;
        setState(
          error instanceof CommitNotFoundError
            ? {
                kind: "failed",
                title: "This request doesn’t exist",
                detail: "It may belong to another account.",
              }
            : {
                kind: "failed",
                title: "This request couldn’t be loaded",
                detail:
                  error instanceof Error ? error.message : "Try again later.",
              },
        );
      },
    );
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [commitRef]);

  if (state.kind === "loading")
    return (
      <LoadingPane
        label="Loading the transaction"
        className="absolute inset-0"
      />
    );
  if (state.kind === "ready")
    return <CommitSignPanel handle={state.handle} onClose={home} />;
  return (
    <AomiSheet backdrop={false}>
      <SheetHeader
        title={state.title}
        description={state.detail}
        onClose={home}
      />
    </AomiSheet>
  );
}
