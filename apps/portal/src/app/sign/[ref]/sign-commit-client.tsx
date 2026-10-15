"use client";

import { useEffect, useState } from "react";
import {
  AomiClient,
  AomiCommits,
  CommitNotFoundError,
  type CommitHandle,
} from "@aomi-labs/client";
import {
  CommitSignPanel,
  getBackendUrl,
} from "@aomi-labs/widget/host-composition";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; handle: CommitHandle }
  | { kind: "missing" }
  | { kind: "error"; message: string };

/** Same-origin BFF: the Better Auth cookie is the credential. */
function createCommits(): AomiCommits {
  return new AomiCommits(
    new AomiClient({
      baseUrl: getBackendUrl(),
      guest: false,
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          credentials: "same-origin",
          cache: "no-store",
        }),
    }),
  );
}

/** A centered host for the widget's own review of one commit. */
export function SignCommitClient({ commitRef }: { commitRef: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let opened: CommitHandle | undefined;
    setState({ kind: "loading" });
    createCommits()
      .get(commitRef)
      .then(
        (handle) => {
          if (cancelled) return handle.close();
          opened = handle;
          setState({ kind: "ready", handle });
        },
        (error: unknown) => {
          if (cancelled) return;
          setState(
            error instanceof CommitNotFoundError
              ? { kind: "missing" }
              : {
                  kind: "error",
                  message:
                    error instanceof Error
                      ? error.message
                      : "This request could not be loaded",
                },
          );
        },
      );
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [commitRef]);

  return (
    <main
      data-testid="sign-page"
      className="bg-aomi-bg text-aomi-fg flex h-full w-full justify-center overflow-y-auto px-4 py-10 sm:items-center"
    >
      <div className="w-full max-w-md">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">
          Review transaction
        </h1>
        {state.kind === "loading" ? (
          <p role="status" className="type-meta text-aomi-muted">
            Loading request…
          </p>
        ) : state.kind === "missing" ? (
          <p role="alert" className="type-meta text-aomi-muted">
            This request does not exist, or it belongs to another account.
          </p>
        ) : state.kind === "error" ? (
          <p role="alert" className="type-meta text-aomi-danger">
            {state.message}
          </p>
        ) : (
          <CommitSignPanel handle={state.handle} />
        )}
        <a
          href={
            state.kind === "ready" && state.handle.view.origin !== "telegram"
              ? `/?thread=${encodeURIComponent(state.handle.view.thread_id)}`
              : "/"
          }
          className="type-meta text-aomi-muted hover:text-aomi-fg mt-6 inline-block"
        >
          {state.kind === "ready" && state.handle.view.origin !== "telegram"
            ? "Open the chat"
            : "Back to Aomi"}
        </a>
      </div>
    </main>
  );
}
