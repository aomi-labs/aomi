"use client";

import {
  lazy,
  Suspense,
  useEffect,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import { Clock, Send, Wallet } from "lucide-react";
import {
  CommitStaleError,
  isTerminalCommit,
  projectCommitLifecycle,
  shortAddress,
  type AomiAccountConnection,
  type CommitHandle,
  type CommitRefView,
  type ThreadOrigin,
} from "@aomi-labs/client";
import { useDisplayQuery } from "@aomi-labs/react";
import { AomiButton, aomiButton } from "@/ui/aomi/button";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { SheetHeader } from "@/wallet/picker/sheet-parts";
import { useAomiWalletKit } from "@/wallet/context";
import { useCommitCapabilities } from "@/wallet/use-action-capabilities";
import { useShellTransport } from "@/account/transport";
import { connectionsQuery } from "@/account/account-queries";
import { TransactionReview } from "@/sidebar/activity/transaction-review";
import { StatusPill } from "@/ui/aomi/status-pill";
import { CommitTransactions } from "./commit-transactions";

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

/** `expires in 8:41`, ticking. */
function useExpiry(expiresAt: number | undefined): string | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAt === undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  if (expiresAt === undefined) return undefined;
  const left = Math.max(0, Math.round(expiresAt - now / 1000));
  return `expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

function signerConnected(
  view: CommitRefView,
  identity: { address?: string; svmAddress?: string },
): boolean {
  return view.chain_family === "evm"
    ? identity.address?.toLowerCase() === view.signer.toLowerCase()
    : identity.svmAddress === view.signer;
}

/** The connection that asked, from the commit's `notify` (else `initiator`) key. */
function sourceOf(
  view: CommitRefView,
  connections: readonly AomiAccountConnection[] | undefined,
) {
  const key = view.notify || view.initiator;
  return connections?.find(
    (row) => key === row.key || key.startsWith(`${row.key}:`),
  );
}

export type CommitSignPanelProps = {
  /** The commit, opened with `aomi.commits.get(ref)`. */
  handle: CommitHandle;
  /** The header's close button. */
  onClose: () => void;
};

/**
 * The sign page's sheet for one commit: the review, then a tick, an expiry
 * or a refusal. Asks for exactly the commit's signer, then signs through the
 * handle; an agent-wallet commit only needs Approve.
 */
export function CommitSignPanel({ handle, onClose }: CommitSignPanelProps) {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useEffect(() => handle.subscribe(rerender), [handle]);
  const wallet = useAomiWalletKit();
  const capabilities = useCommitCapabilities();
  const { client } = useShellTransport();
  const connections = useDisplayQuery(connectionsQuery(client));
  const view = handle.view;
  const parkedOrSigning = view.signing_mode === "auto";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const review = handle.review;
  const lifecycle = projectCommitLifecycle(
    view,
    handle.submissionPhase,
    handle.recoveryRecord,
  );
  const expiry = useExpiry(
    view.state === "awaiting_approval" ? view.approval?.expires_at : undefined,
  );
  const family = view.chain_family === "evm" ? "evm" : "svm";
  const connected = signerConnected(view, wallet.identity);
  const terminal = isTerminalCommit(view);
  const inFlight =
    !terminal &&
    (view.state === "submitted" ||
      lifecycle.phase === "signing" ||
      lifecycle.phase === "submitted");
  const awaitingWallet = Boolean(view.action) && !terminal && !parkedOrSigning;
  const canSign = connected && handle.canSign(capabilities);
  const signerRow = wallet.wallets.find(
    (row) =>
      row.family === family &&
      (family === "evm"
        ? row.address.toLowerCase() === view.signer.toLowerCase()
        : row.address === view.signer),
  );
  const source = sourceOf(view, connections.data?.connections);
  const from = source?.name ?? ORIGIN_LABELS[view.origin] ?? view.origin;

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

  // Where "back" goes once the trade is done or gone.
  const telegramBack =
    source?.kind === "telegram" && source.name.startsWith("@")
      ? `https://t.me/${source.name.slice(1)}`
      : undefined;
  const goBack =
    source?.kind === "cli"
      ? "Go back to your terminal. You can close this tab."
      : source && (source.kind === "ai" || source.kind === "app")
        ? `Go back to ${source.name}. You can close this tab.`
        : undefined;
  const backButton = (primary: boolean) =>
    telegramBack ? (
      <a
        href={telegramBack}
        className={`${aomiButton({ variant: primary ? "primary" : "secondary" })} h-10 w-full`}
      >
        <Send />
        Back to {source!.name}
      </a>
    ) : !goBack && view.origin !== "telegram" ? (
      <a
        href={`/?thread=${encodeURIComponent(view.thread_id)}`}
        className={`${aomiButton({ variant: "secondary" })} h-10 w-full`}
      >
        Open the chat
      </a>
    ) : null;

  const done = (
    title: string,
    description: ReactNode,
    icon: ReactNode,
    action: ReactNode,
  ) => (
    <AomiSheet backdrop={false}>
      <SheetHeader title={title} description={description} onClose={onClose} />
      <div
        data-commit-ref={handle.ref}
        data-commit-state={view.state}
        className="flex flex-col items-center gap-4 px-5 pb-5"
      >
        {icon}
        {action}
      </div>
    </AomiSheet>
  );

  if (view.state === "confirmed") {
    const explorer = view.transaction_url ? (
      <a
        href={view.transaction_url}
        target="_blank"
        rel="noreferrer"
        className="hover:text-aomi-fg underline underline-offset-2"
      >
        View on explorer
      </a>
    ) : undefined;
    return done(
      "Transaction confirmed",
      goBack ?? explorer,
      review ? (
        <CommitTransactions view={view} review={review} />
      ) : (
        <StatusPill tone="success" dot>
          Confirmed
        </StatusPill>
      ),
      goBack ? explorer : backButton(true),
    );
  }
  if (view.state === "expired")
    return done(
      "This request expired",
      goBack ?? "Nothing was signed. Ask again in the chat.",
      <Clock className="text-aomi-muted size-12" strokeWidth={1.5} />,
      backButton(false),
    );
  if (terminal) return done(lifecycle.label, goBack, null, backButton(false));
  return (
    <AomiSheet backdrop={false}>
      <SheetHeader
        title="Review trade"
        description={[
          `From ${from}`,
          expiry ?? commitRelativeTime(view.created_at),
        ]
          .filter(Boolean)
          .join(" · ")}
        onClose={onClose}
      />
      <section
        aria-label="Transaction request"
        data-commit-ref={handle.ref}
        data-commit-state={view.state}
        className="flex min-h-0 flex-col overflow-y-auto px-5 pb-5"
      >
        {review && (parkedOrSigning || awaitingWallet || inFlight) ? (
          <CommitTransactions
            view={view}
            review={review}
            executing={inFlight}
          />
        ) : null}
        {parkedOrSigning ? (
          <Suspense fallback={null}>
            <CommitApprovePanel handle={handle} signing={inFlight} />
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
        {!parkedOrSigning && (awaitingWallet || inFlight) && review ? (
          <TransactionReview
            review={{
              id: view.commit_id,
              revision: view.review?.revision ?? view.version,
              request: review,
            }}
            supportedChains={wallet.supportedChains}
            approving={
              busy ||
              inFlight ||
              ["preparing", "switching_chain", "awaiting_wallet"].includes(
                lifecycle.phase,
              )
            }
            approveDisabled={!canSign}
            status={error}
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
        {awaitingWallet && !review ? (
          <p role="status" className="type-meta text-aomi-muted mt-3">
            This request has no review to show yet.
          </p>
        ) : null}
      </section>
    </AomiSheet>
  );
}
