"use client";

import { lazy, Suspense, useEffect, useReducer, useState } from "react";
import { ExternalLink, Wallet } from "lucide-react";
import {
  CommitStaleError,
  isTerminalCommit,
  projectCommitLifecycle,
  shortAddress,
  type CommitHandle,
  type CommitRefView,
  type ThreadOrigin,
} from "@aomi-labs/client";
import { AomiButton } from "@/ui/aomi/button";
import { useAomiWalletKit } from "@/wallet/context";
import { useCommitCapabilities } from "@/wallet/use-action-capabilities";
import { TransactionReview } from "@/sidebar/activity/transaction-review";
import { ImpactPanel } from "@/sidebar/activity/wallet-impact";

const CommitApprovePanel = lazy(() =>
  import("./approval").then((module) => ({
    default: module.CommitApprovePanel,
  })),
);

const ORIGIN_LABELS: Record<ThreadOrigin, string> = {
  portal: "Portal",
  widget: "Widget",
  cli: "CLI",
  sdk: "SDK",
  mcp: "MCP",
  api: "API",
  telegram: "Telegram",
  cron: "Scheduled task",
};

/** `created_at` (unix seconds) relative to `now` (milliseconds). */
export function commitRelativeTime(
  createdAt: number | null | undefined,
  now = Date.now(),
): string | undefined {
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt))
    return undefined;
  const seconds = Math.round(createdAt - now / 1000);
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps)
    if (Math.abs(seconds) >= size)
      return format.format(Math.round(seconds / size), unit);
  return "just now";
}

function signerConnected(
  view: CommitRefView,
  identity: { address?: string; svmAddress?: string },
): boolean {
  return view.chain_family === "evm"
    ? identity.address?.toLowerCase() === view.signer.toLowerCase()
    : identity.svmAddress === view.signer;
}

export type CommitSignPanelProps = {
  /** The commit, opened with `aomi.commits.get(ref)`. */
  handle: CommitHandle;
  /** Display name for `origin_app`, when the host knows it. */
  appName?: string;
};

/**
 * The widget's own transaction review for one commit, outside any chat.
 * Asks for exactly the commit's signer, then signs through the handle.
 */
export function CommitSignPanel({ handle, appName }: CommitSignPanelProps) {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useEffect(() => handle.subscribe(rerender), [handle]);
  const wallet = useAomiWalletKit();
  const capabilities = useCommitCapabilities();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const view = handle.view;
  const review = handle.review;
  const lifecycle = projectCommitLifecycle(
    view,
    handle.submissionPhase,
    handle.recoveryRecord,
  );
  const family = view.chain_family === "evm" ? "evm" : "svm";
  const connected = signerConnected(view, wallet.identity);
  const settled =
    isTerminalCommit(view) ||
    view.state === "submitted" ||
    lifecycle.phase === "signing";
  // An agent-wallet commit: once approved, Aomi signs it; no wallet here.
  const serverSigned = view.signing_mode === "auto";
  const awaitingWallet = Boolean(view.action) && !settled && !serverSigned;
  const serverSigning =
    serverSigned && !settled && view.state !== "awaiting_approval";
  const canSign = connected && handle.canSign(capabilities);
  const time = commitRelativeTime(view.created_at);
  const signerRow = wallet.wallets.find(
    (row) =>
      row.family === family &&
      (family === "evm"
        ? row.address.toLowerCase() === view.signer.toLowerCase()
        : row.address === view.signer),
  );

  const run = async (step: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await step();
    } catch (caught) {
      if (caught instanceof CommitStaleError) {
        setError("This request changed. Review it again before signing.");
        await handle.refresh().catch(() => undefined);
      } else {
        setError(
          caught instanceof Error ? caught.message : "The request failed",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Transaction request"
      data-commit-ref={handle.ref}
      data-commit-state={view.state}
      className="text-aomi-fg w-full min-w-0"
    >
      <p className="type-meta text-aomi-muted">
        From {appName ?? ORIGIN_LABELS[view.origin] ?? view.origin}
        {time ? ` · ${time}` : ""}
      </p>
      {view.state === "awaiting_approval" ? (
        <Suspense fallback={null}>
          <CommitApprovePanel handle={handle} />
        </Suspense>
      ) : null}
      {awaitingWallet && !connected ? (
        <div className="border-aomi-border bg-aomi-raised rounded-card mt-3 grid gap-3 border p-3">
          <p className="type-meta">
            Connect{" "}
            <span title={view.signer} className="type-address">
              {shortAddress(view.signer, { head: 8, tail: 6 })}
            </span>{" "}
            to review and sign this request.
          </p>
          <AomiButton
            variant="secondary"
            onClick={() =>
              void run(async () => {
                if (signerRow && wallet.activateWallet)
                  await wallet.activateWallet(signerRow.key);
                else await wallet.connect({ family });
              })
            }
            disabled={busy || (!signerRow && !wallet.canConnect)}
          >
            <Wallet />
            {signerRow ? "Switch to this wallet" : "Connect wallet"}
          </AomiButton>
        </div>
      ) : null}
      {awaitingWallet && review ? (
        <TransactionReview
          review={{
            id: view.commit_id,
            revision: view.review?.revision ?? view.version,
            request: review,
          }}
          supportedChains={wallet.supportedChains}
          approving={
            busy ||
            ["preparing", "switching_chain", "awaiting_wallet"].includes(
              lifecycle.phase,
            )
          }
          approveDisabled={!canSign}
          status={
            error ??
            (lifecycle.phase === "rejected" ? lifecycle.label : undefined)
          }
          statusIsError={Boolean(error)}
          recoveringExistingAttempt={Boolean(
            view.wallet_attempt || handle.recoveryRecord?.attemptId,
          )}
          onApprove={() =>
            void run(() =>
              handle.sign(capabilities, {
                expectedVersion: view.version,
                expectedReviewDigest: view.review?.digest,
              }),
            )
          }
          onReject={() => void run(() => handle.reject())}
        />
      ) : null}
      {serverSigning ? (
        <div className="mt-3 grid gap-3">
          {review ? (
            <ImpactPanel
              request={review}
              balanceChanges={
                review.type === "sign"
                  ? []
                  : (review.simulation?.balanceChanges ?? [])
              }
              approvals={
                review.type === "sign"
                  ? []
                  : (review.simulation?.approvals ?? [])
              }
              supportedChains={wallet.supportedChains}
              showNetwork
              failed={false}
            />
          ) : null}
          <p role="status" className="type-meta text-aomi-muted">
            Approved · Aomi is signing with your agent wallet.
          </p>
        </div>
      ) : null}
      {awaitingWallet && !review ? (
        <p role="status" className="type-meta text-aomi-muted mt-3">
          This request has no review to show yet.
        </p>
      ) : null}
      {settled ? (
        <div
          role="status"
          className="border-aomi-border bg-aomi-raised rounded-card mt-3 grid gap-2 border p-3"
        >
          <p className="font-medium">{lifecycle.label}</p>
          {view.transaction_url ? (
            <a
              href={view.transaction_url}
              target="_blank"
              rel="noreferrer"
              className="type-meta text-aomi-muted hover:text-aomi-fg inline-flex w-fit items-center gap-1.5"
            >
              View on explorer
              <ExternalLink className="size-3.5" />
            </a>
          ) : lifecycle.transactionId ? (
            <p
              title={lifecycle.transactionId}
              className="type-meta type-address text-aomi-muted truncate"
            >
              {shortAddress(lifecycle.transactionId, { head: 10, tail: 8 })}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="type-meta text-aomi-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
