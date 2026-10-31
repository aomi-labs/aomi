"use client";
import { cn } from "@/lib/cn";
import { useEffect, useRef, type ReactNode } from "react";
import type { Action, ActionRequest, MessageReview } from "@aomi-labs/client";
import {
  isMessageReview,
  reviewEligibility,
  shortAddress,
} from "@aomi-labs/client";
import {
  ExternalLink,
  Wallet,
  Fuel,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import { AomiButton, aomiButton } from "@/ui/aomi/button";
import { testIds } from "@/test-ids";
import { ImpactPanel } from "./wallet-impact";
import {
  type SupportedChain,
  visibleSimulationWarnings,
  simulationCostSummary,
  focusRing,
} from "./presentation";

/** The review actions keep their pill shape: they are the panel's one decision. */
const reviewButtonClass = cn(focusRing, "h-10 rounded-full");
// One half of the "<action> · n of m | Submit all" split button. No size
// variant: the shared pill container owns the radius, so the halves stay square.
const splitSegment = cn(
  aomiButton({ variant: "primary", size: null }),
  focusRing,
  "type-control h-10 rounded-none px-3",
);

/** The signer isn't the active wallet: the primary action gets it ready first. */
export type ConnectAction = {
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
};

export type TransactionReviewData = Pick<Action, "id" | "revision"> & {
  request: ActionRequest;
};

export function TransactionReview({
  review,
  supportedChains,
  approving = false,
  approveDisabled = false,
  approveLabel,
  approveHref,
  connect,
  note,
  rejectDisabled = false,
  status,
  statusIsError = false,
  recoveringExistingAttempt = false,
  onApprove,
  onApproveAll,
  approveAllDisabled = false,
  batchProgress,
  submitting = false,
  prompts = 0,
  onReject,
}: {
  review: TransactionReviewData;
  supportedChains?: readonly SupportedChain[];
  approving?: boolean;
  approveDisabled?: boolean;
  approveLabel?: string;
  /** Approve happens elsewhere: the primary action opens this URL. */
  approveHref?: string;
  connect?: ConnectAction;
  /** One line above the actions, e.g. who signs after approval. */
  note?: string;
  rejectDisabled?: boolean;
  status?: string;
  statusIsError?: boolean;
  recoveringExistingAttempt?: boolean;
  onApprove: () => void;
  onApproveAll?: () => void;
  approveAllDisabled?: boolean;
  /** Which group of the queue this is. */
  batchProgress?: { current: number; total: number };
  /** Groups are going out one after another. */
  submitting?: boolean;
  /** Wallet prompts this group asks for. */
  prompts?: number;
  onReject: () => void;
}) {
  const reviewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const review = reviewRef.current;
    if (!review) return;
    // Reveal within the sidebar without moving the chat's clipping ancestors.
    const rail = review.closest<HTMLElement>(".aui-activity-sidebar");
    if (rail) {
      const overflow =
        review.getBoundingClientRect().bottom -
        rail.getBoundingClientRect().bottom;
      if (overflow > 0) rail.scrollTop += overflow + 16;
    }
  }, [review.id, review.revision]);
  const simulation =
    review.request.type === "sign" ? undefined : review.request.simulation;
  const eligibility = reviewEligibility(review.request);
  // A message commit: its decoded rows and its check stand in for the
  // simulation; nothing runs on chain.
  const message = isMessageReview(review.request) ? review.request : undefined;
  const messageReview: MessageReview | undefined = message
    ? (message.messageReview ?? { kind: "generic", rows: [] })
    : undefined;
  const warnings = messageReview
    ? messageReview.warning
      ? [messageReview.warning]
      : []
    : visibleSimulationWarnings(simulation);
  const simulationFailed =
    simulation?.status === "failed" ||
    simulation?.guards.some((guard) => guard.status === "failed");
  const failed =
    !recoveringExistingAttempt &&
    (eligibility ? eligibility.state !== "eligible" : simulationFailed);
  const request = review.request;
  // A signed Solana transaction is still sent; any other sign is a message.
  const signs =
    request.type === "sign" && request.executionKind !== "transaction";
  const count = request.type === "sign" ? 1 : request.transactions.length;
  const action =
    approveLabel ??
    (signs
      ? "Sign message"
      : count > 1
        ? `Send ${count} transactions`
        : "Send transaction");
  const label =
    approveLabel || !batchProgress
      ? action
      : `${action} · ${batchProgress.current} of ${batchProgress.total}`;
  const busy = approving || submitting;
  const busyLabel = signs ? "Signing…" : "Sending…";
  const split = Boolean(onApproveAll && batchProgress && !busy);
  const signers =
    request.type === "sign"
      ? [request.signer]
      : request.type === "execute_evm"
        ? request.transactions.map((tx) => tx.from)
        : request.transactions.map((tx) => tx.payer);
  // The simulation reports every account the transaction touches; the card
  // shows what the signing wallet gains and loses (as Telegram does).
  const ownChanges = (simulation?.balanceChanges ?? []).filter(
    (change) =>
      !change.account ||
      signers.some((signer) =>
        signer?.startsWith("0x")
          ? signer.toLowerCase() === change.account!.toLowerCase()
          : signer === change.account,
      ),
  );
  return (
    <section
      ref={reviewRef}
      data-testid={testIds.txReview}
      data-action-id={review.id}
      aria-label="Wallet impact"
      className="text-aomi-fg animate-in fade-in-0 slide-in-from-top-2 mt-3 min-w-0 duration-300 motion-reduce:animate-none"
    >
      {warnings.length > 0 && (
        <div className="border-aomi-warning/20 bg-aomi-warning/5 text-aomi-warning rounded-card type-meta mb-3 border p-3">
          {warnings.map((warning, index) => (
            <p key={index} className="break-words">
              {warning}
            </p>
          ))}
        </div>
      )}
      <div className="space-y-3">
        <ImpactPanel
          key={`${review.id}-${review.revision}`}
          request={request}
          balanceChanges={ownChanges}
          approvals={simulation?.approvals ?? []}
          message={messageReview}
          supportedChains={supportedChains}
          showNetwork
          failed={simulationFailed ?? false}
        />
        {request.type === "sign" ? (
          <SigningRequestMetadata request={request} />
        ) : null}
        <dl className="type-meta flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {[...new Set(signers)].filter(Boolean).map((signer) => (
            <div key={signer} className="flex items-center gap-2">
              <Wallet className="text-aomi-muted size-3.5 shrink-0" />
              <dt className="sr-only">Signing wallet</dt>
              <dd title={signer} className="type-address truncate">
                {shortAddress(signer, { head: 8, tail: 6 })}
              </dd>
            </div>
          ))}
          {message && eligibility?.state === "eligible" ? (
            <div className="text-aomi-success flex items-center gap-2">
              <ShieldCheck className="size-3.5 shrink-0" />
              <dt className="sr-only">Check</dt>
              <dd>Check passed</dd>
            </div>
          ) : null}
          {simulation && !simulationFailed && (
            <div
              className={cn(
                "flex items-center gap-2",
                simulation.status === "passed"
                  ? "text-aomi-success"
                  : "text-aomi-muted",
              )}
            >
              {simulation.status === "passed" ? (
                <ShieldCheck className="size-3.5 shrink-0" />
              ) : (
                <ShieldQuestion className="size-3.5 shrink-0" />
              )}
              <dt className="sr-only">Simulation</dt>
              <dd>
                {simulation.status === "passed"
                  ? "Simulation passed"
                  : "Simulation unavailable"}
              </dd>
            </div>
          )}
          <div className="text-aomi-muted flex items-center gap-2">
            <Fuel className="size-3.5 shrink-0" />
            <dt className="flex-1">{simulationCostSummary(simulation)}</dt>
          </div>
        </dl>
      </div>
      {/* The exact signed payload, always: rows summarize it, they never
          replace it (a long message's text row is cut short). */}
      {request.type === "sign" && (
        <details className="type-meta text-aomi-muted mt-3">
          <summary
            className={cn(focusRing, "rounded-control w-fit cursor-pointer")}
          >
            {message ? "Full message" : "Signing request"}
          </summary>
          <pre className="bg-aomi-surface rounded-control mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all p-2">
            {message
              ? message.payloads
                  .map((payload) =>
                    payload.kind === "evm_personal"
                      ? payload.message
                      : JSON.stringify(
                          payload.kind === "evm_typed_data"
                            ? payload.typed_data
                            : payload,
                          null,
                          2,
                        ),
                  )
                  .join("\n\n")
              : JSON.stringify(request, null, 2)}
          </pre>
        </details>
      )}
      {status && (
        <p
          role={statusIsError ? "alert" : "status"}
          className="type-meta text-aomi-muted mt-3"
        >
          {status}
        </p>
      )}
      {note && !failed ? (
        <p className="type-meta text-aomi-muted mt-3">{note}</p>
      ) : null}
      {!failed && prompts > 1 ? (
        <p className="type-meta text-aomi-muted mt-3 flex items-center gap-1.5">
          <Wallet className="size-3.5 shrink-0" />
          Your wallet asks for {prompts} signatures, in order.
        </p>
      ) : null}
      <footer
        className={
          failed
            ? "mt-3"
            : split
              ? "mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-2"
              : "mt-3 grid grid-cols-[1fr_1.7fr] gap-2"
        }
      >
        <AomiButton
          variant="danger"
          className={reviewButtonClass}
          onClick={onReject}
          disabled={approving || rejectDisabled}
        >
          {failed ? "Reject request" : "Reject"}
        </AomiButton>
        {!failed &&
          (connect ? (
            <AomiButton
              variant={connect.variant ?? "secondary"}
              className={reviewButtonClass}
              onClick={connect.onClick}
              disabled={approving || connect.disabled}
            >
              {connect.label}
            </AomiButton>
          ) : split ? (
            <div className="bg-aomi-fg text-aomi-bg flex min-w-0 overflow-hidden rounded-full">
              <button
                type="button"
                onClick={onApprove}
                disabled={approveDisabled}
                className={`${splitSegment} min-w-0 flex-1`}
              >
                <span className="truncate">{label}</span>
              </button>
              <span
                className="bg-aomi-bg/25 my-2 w-px shrink-0"
                aria-hidden="true"
              />
              <button
                type="button"
                onClick={onApproveAll}
                disabled={approveDisabled || approveAllDisabled}
                className={splitSegment}
              >
                Submit all
              </button>
            </div>
          ) : approveHref ? (
            <a
              href={approveHref}
              target="_blank"
              rel="noreferrer"
              className={cn(
                aomiButton({ variant: "primary" }),
                reviewButtonClass,
              )}
            >
              <span className="truncate">
                {approveLabel ?? "Approve on Aomi"}
              </span>
              <ExternalLink />
            </a>
          ) : (
            <AomiButton
              variant="primary"
              className={reviewButtonClass}
              onClick={onApprove}
              disabled={busy || approveDisabled}
            >
              <Wallet />
              <span className="truncate">{busy ? busyLabel : label}</span>
            </AomiButton>
          ))}
      </footer>
    </section>
  );
}
function SigningRequestMetadata({
  request,
}: {
  request: Extract<ActionRequest, { type: "sign" }>;
}) {
  if (!request.broadcaster) return null;
  return (
    <dl className="border-aomi-border bg-aomi-raised rounded-card type-meta grid gap-2 border p-3">
      <div className="flex items-start justify-between gap-3">
        <dt className="text-aomi-muted">Submitted by</dt>
        <dd className="max-w-[60%] break-words text-right font-medium">
          {request.broadcaster}
        </dd>
      </div>
    </dl>
  );
}
