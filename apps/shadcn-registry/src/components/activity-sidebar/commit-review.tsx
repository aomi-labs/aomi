"use client";
import { useEffect, useState } from "react";
import { useAomiRuntime } from "@aomi-labs/react";
import { isTerminalCommit } from "@aomi-labs/client";
import { Fuel } from "lucide-react";
import { Button } from "../ui/button";
import { useAomiWalletKit } from "../../lib/wallet-kit";
import { useCommitCapabilities } from "../../lib/wallet-kit/use-action-capabilities";
import { ImpactPanel } from "./wallet-impact";
import {
  simulationCostSummary,
  visibleSimulationWarnings,
} from "./presentation";

/** Displays the same tagged view for Wallet, Venue and Hosted work. Only a
 * chain-confirmed view is labelled confirmed; submitted remains pending. A
 * commit's simulated effects lead; the exact signable stays one click away. */
export function CommitReview() {
  const { commits = [], commitController } = useAomiRuntime();
  const capabilities = useCommitCapabilities();
  const { supportedChains } = useAomiWalletKit();
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
      {commits.map((commit) => {
        const review = commitController?.review(commit.commit_id);
        const warnings = visibleSimulationWarnings(review?.simulation);
        return (
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
            {warnings.length > 0 && (
              <div className="border-aomi-warning/20 bg-aomi-warning/5 text-aomi-warning rounded-xl border p-3 text-[12px]">
                {warnings.map((warning, index) => (
                  <p key={index} className="break-words">
                    {warning}
                  </p>
                ))}
              </div>
            )}
            {review && (
              <>
                <ImpactPanel
                  request={review}
                  balanceChanges={review.simulation.balanceChanges}
                  approvals={review.simulation.approvals ?? []}
                  supportedChains={supportedChains}
                  showNetwork
                  failed={review.simulation.status === "failed"}
                />
                <p className="text-aomi-muted flex items-center gap-2 text-[11px]">
                  <Fuel className="size-3.5 shrink-0" />
                  {simulationCostSummary(review.simulation)}
                </p>
              </>
            )}
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
        );
      })}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
