"use client";
import { useEffect, useRef } from "react";
import type { Action, ActionRequest } from "@aomi-labs/client";
import { reviewEligibility, shortAddress } from "@aomi-labs/client";
import { Wallet, Fuel, ShieldCheck, ShieldQuestion } from "lucide-react";
import { cn } from "@aomi-labs/react";
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
// One half of the "Submit n of m | Submit all" split button. No size variant:
// the shared pill container owns the radius, so the halves stay square.
const splitSegment = cn(
  aomiButton({ variant: "primary", size: null }),
  focusRing,
  "type-control h-10 rounded-none px-3",
);

export type TransactionReviewData = Pick<Action, "id" | "revision"> & {
  request: ActionRequest;
};

export function TransactionReview({
  review,
  supportedChains,
  approving = false,
  approveDisabled = false,
  approveLabel,
  rejectDisabled = false,
  status,
  statusIsError = false,
  recoveringExistingAttempt = false,
  onApprove,
  onApproveAll,
  approveAllDisabled = false,
  batchProgress,
  onReject,
}: {
  review: TransactionReviewData;
  supportedChains?: readonly SupportedChain[];
  approving?: boolean;
  approveDisabled?: boolean;
  approveLabel?: string;
  rejectDisabled?: boolean;
  status?: string;
  statusIsError?: boolean;
  recoveringExistingAttempt?: boolean;
  onApprove: () => void;
  onApproveAll?: () => void;
  approveAllDisabled?: boolean;
  batchProgress?: { current: number; total: number; submitting: boolean };
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
  const warnings = visibleSimulationWarnings(simulation);
  const simulationFailed =
    simulation?.status === "failed" ||
    simulation?.guards.some((guard) => guard.status === "failed");
  const failed =
    !recoveringExistingAttempt &&
    (eligibility ? eligibility.state !== "eligible" : simulationFailed);
  const request = review.request;
  const signers =
    request.type === "sign"
      ? [request.signer]
      : request.type === "execute_evm"
        ? request.transactions.map((tx) => tx.from)
        : request.transactions.map((tx) => tx.payer);
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
          balanceChanges={simulation?.balanceChanges ?? []}
          approvals={simulation?.approvals ?? []}
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
      {request.type === "sign" && (
        <details className="type-meta text-aomi-muted mt-3">
          <summary
            className={cn(focusRing, "rounded-control w-fit cursor-pointer")}
          >
            Signing request
          </summary>
          <pre className="bg-aomi-surface rounded-control mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all p-2">
            {JSON.stringify(request, null, 2)}
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
      <footer
        className={
          failed
            ? "mt-3"
            : onApproveAll && batchProgress
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
          (onApproveAll && batchProgress ? (
            <div className="bg-aomi-fg text-aomi-bg flex min-w-0 overflow-hidden rounded-full">
              <button
                type="button"
                onClick={onApprove}
                disabled={
                  approving || approveDisabled || batchProgress.submitting
                }
                className={`${splitSegment} min-w-0 flex-1`}
              >
                {approving
                  ? "Working…"
                  : (approveLabel ??
                    `Submit ${batchProgress.current} of ${batchProgress.total}`)}
              </button>
              <span
                className="bg-aomi-bg/25 my-2 w-px shrink-0"
                aria-hidden="true"
              />
              <button
                type="button"
                onClick={onApproveAll}
                disabled={
                  approving ||
                  approveDisabled ||
                  approveAllDisabled ||
                  batchProgress.submitting
                }
                className={splitSegment}
              >
                {batchProgress.submitting ? "Submitting…" : "Submit all"}
              </button>
            </div>
          ) : (
            <AomiButton
              variant="primary"
              className={reviewButtonClass}
              onClick={onApprove}
              disabled={
                approving || approveDisabled || batchProgress?.submitting
              }
            >
              <Wallet />
              {approving
                ? "Working…"
                : approveLabel
                  ? approveLabel
                  : batchProgress
                    ? `Submit ${batchProgress.current} of ${batchProgress.total}`
                    : "Submit"}
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
  const facts = [
    request.broadcaster
      ? { label: "Submitted by", value: request.broadcaster }
      : undefined,
    request.sponsorship
      ? {
          label: "Network funding",
          value:
            request.sponsorship === "required"
              ? "Sponsorship required"
              : "User-funded",
        }
      : undefined,
    request.maxNetworkFee
      ? {
          label: "Network cost ceiling",
          value: `${request.maxNetworkFee} native base units`,
        }
      : undefined,
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact));

  if (facts.length === 0 && !request.fees?.length) return null;
  return (
    <dl className="border-aomi-border bg-aomi-raised rounded-card type-meta grid gap-2 border p-3">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="flex items-start justify-between gap-3"
        >
          <dt className="text-aomi-muted">{fact.label}</dt>
          <dd className="max-w-[60%] break-words text-right font-medium">
            {fact.value}
          </dd>
        </div>
      ))}
      {request.fees?.map((fee, index) => (
        <div
          key={`${fee.recipient}-${index}`}
          className="border-aomi-border flex items-start justify-between gap-3 border-t pt-2"
        >
          <dt className="text-aomi-muted">Application fee</dt>
          <dd className="max-w-[60%] break-all text-right font-medium">
            {fee.amount}{" "}
            {fee.asset.kind === "native"
              ? "native"
              : shortAddress(fee.asset.address, { head: 8, tail: 6 })}
            {" → "}
            {shortAddress(fee.recipient, { head: 8, tail: 6 })}
          </dd>
        </div>
      ))}
    </dl>
  );
}
