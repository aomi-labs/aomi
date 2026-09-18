"use client";
import { useEffect, useState } from "react";
import { useAomiRuntime } from "@aomi-labs/react";
import { isTerminalCommit } from "@aomi-labs/client";
import { Button } from "../ui/button";
import { useCommitCapabilities } from "../../lib/wallet-kit/use-action-capabilities";

/** Displays the same tagged view for Wallet, Venue and Hosted work. Only a
 * chain-confirmed view is labelled confirmed; submitted remains pending. */
export function CommitReview() {
  const { commits = [], commitController } = useAomiRuntime();
  const capabilities = useCommitCapabilities();
  useEffect(() => {
    commitController?.setWalletCapabilities(capabilities);
    return () => commitController?.setWalletCapabilities({});
  }, [commitController, capabilities]);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  if (!commits.length) return null;
  const decide = async (id: string, approved: boolean) => {
    if (!commitController || busy) return;
    setBusy(id);
    setError(undefined);
    try {
      await (approved
        ? commitController.execute(id)
        : commitController.reject(id));
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Commit action failed",
      );
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <section aria-label="Commits" className="space-y-3 py-4">
      {commits.map((commit) => (
        <article
          key={commit.commit_id}
          data-commit-id={commit.commit_id}
          className="space-y-2 text-xs"
        >
          <h3 className="font-medium">
            {commit.chain_family.toUpperCase()} · {commit.broadcaster}
          </h3>
          <p role="status">
            {commit.state === "submitted"
              ? "Submitted — awaiting chain confirmation"
              : commit.state.replaceAll("_", " ")}
          </p>
          <p className="break-all">{commit.signer}</p>
          {commit.transaction_id && (
            <p className="break-all">{commit.transaction_id}</p>
          )}
          {commit.failure_code && <p role="alert">{commit.failure_code}</p>}
          {commit.action && (
            <details>
              <summary>Exact request</summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(commit.action, null, 2)}
              </pre>
            </details>
          )}
          {!isTerminalCommit(commit) && commit.action && (
            <div className="flex gap-2">
              {commit.state === "needs_signature" && (
                <Button
                  disabled={Boolean(busy)}
                  onClick={() => void decide(commit.commit_id, false)}
                >
                  Reject
                </Button>
              )}
              <Button
                disabled={
                  Boolean(busy) || !commitController?.canExecute(commit)
                }
                onClick={() => void decide(commit.commit_id, true)}
              >
                {busy === commit.commit_id
                  ? "Waiting…"
                  : commit.action.kind === "sign"
                    ? "Sign"
                    : "Broadcast"}
              </Button>
            </div>
          )}
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
