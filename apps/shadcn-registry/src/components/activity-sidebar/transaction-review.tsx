"use client";
import { useEffect, useRef } from "react";
import type { Action, ActionRequest } from "@aomi-labs/client";
import { Wallet, Fuel } from "lucide-react";
import { Button } from "../ui/button";
import { ImpactPanel } from "./wallet-impact";
import {
  type SupportedChain,
  visibleSimulationWarnings,
  compact,
  simulationCostSummary,
} from "./presentation";

export type TransactionReviewData = Pick<Action, "id" | "revision"> & {
  request: ActionRequest;
};

export function TransactionReview({
  review,
  supportedChains,
  approving = false,
  approveDisabled = false,
  rejectDisabled = false,
  status,
  statusTransactionId,
  statusIsError = false,
  onApprove,
  onApproveAll,
  batchProgress,
  onReject,
}: {
  review: TransactionReviewData;
  supportedChains?: readonly SupportedChain[];
  approving?: boolean;
  approveDisabled?: boolean;
  rejectDisabled?: boolean;
  status?: string;
  statusTransactionId?: string;
  statusIsError?: boolean;
  onApprove: () => void;
  onApproveAll?: () => void;
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
  const warnings = visibleSimulationWarnings(simulation);
  const failed =
    simulation?.status === "failed" ||
    simulation?.guards.some((guard) => guard.status === "failed");
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
      data-testid="transaction-review"
      data-action-id={review.id}
      aria-label="Wallet impact"
      className="text-aomi-fg animate-in fade-in-0 slide-in-from-top-2 mt-3 min-w-0 duration-300 motion-reduce:animate-none"
    >
      {warnings.length > 0 && (
        <div className="border-aomi-warning/20 bg-aomi-warning/5 text-aomi-warning mb-3 rounded-xl border p-3 text-[12px]">
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
          failed={failed ?? false}
        />
        {request.type === "sign" ? (
          <SigningRequestMetadata request={request} />
        ) : null}
        <dl className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[11px]">
          {[...new Set(signers)].filter(Boolean).map((signer) => (
            <div key={signer} className="flex items-center gap-2">
              <Wallet className="text-aomi-muted size-3.5 shrink-0" />
              <dt className="sr-only">Signing wallet</dt>
              <dd title={signer} className="truncate">
                {compact(signer)}
              </dd>
            </div>
          ))}
          <div className="text-aomi-muted flex items-center gap-2">
            <Fuel className="size-3.5 shrink-0" />
            <dt className="flex-1">{simulationCostSummary(simulation)}</dt>
          </div>
        </dl>
      </div>
      <details className="text-aomi-muted mt-3 text-[11px]">
        <summary className="cursor-pointer">
          {request.type === "sign" ? "Signing request" : "Transaction details"}
        </summary>
        <pre className="bg-aomi-surface mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg p-2">
          {JSON.stringify(request, null, 2)}
        </pre>
      </details>
      {simulation && (
        <details className="text-aomi-muted mt-2 text-[11px]">
          <summary className="cursor-pointer">Simulation details</summary>
          <pre className="bg-aomi-surface mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg p-2">
            {JSON.stringify(simulation, null, 2)}
          </pre>
        </details>
      )}
      {status && (
        <p
          role={statusIsError ? "alert" : "status"}
          className="text-aomi-muted mt-3 text-[11px]"
        >
          {status}
          {statusTransactionId && (
            <span className="mt-1 block break-all font-mono">
              Transaction: {statusTransactionId}
            </span>
          )}
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
        <Button
          type="button"
          variant="outline"
          onClick={onReject}
          disabled={approving || rejectDisabled}
          className="border-aomi-border bg-aomi-raised text-aomi-muted hover:bg-aomi-hover h-10 rounded-full text-[12px]"
        >
          {failed ? "Reject request" : "Reject"}
        </Button>
        {!failed &&
          (onApproveAll && batchProgress ? (
            <div className="bg-aomi-fg text-aomi-bg flex min-w-0 overflow-hidden rounded-full">
              <Button
                type="button"
                onClick={onApprove}
                disabled={
                  approving || approveDisabled || batchProgress.submitting
                }
                className="bg-aomi-fg text-aomi-bg hover:bg-aomi-fg h-10 min-w-0 flex-1 rounded-none px-3 text-[12px] hover:opacity-90"
              >
                {approving
                  ? "Waiting…"
                  : `Submit ${batchProgress.current} of ${batchProgress.total}`}
              </Button>
              <span
                className="bg-aomi-bg/25 my-2 w-px shrink-0"
                aria-hidden="true"
              />
              <Button
                type="button"
                onClick={onApproveAll}
                disabled={
                  approving || approveDisabled || batchProgress.submitting
                }
                className="bg-aomi-fg text-aomi-bg hover:bg-aomi-fg h-10 shrink-0 rounded-none px-3 text-[12px] hover:opacity-90"
              >
                {batchProgress.submitting ? "Submitting…" : "Submit all"}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              onClick={onApprove}
              disabled={
                approving || approveDisabled || batchProgress?.submitting
              }
              className="bg-aomi-fg text-aomi-bg hover:bg-aomi-fg h-10 rounded-full text-[12px] hover:opacity-90"
            >
              <Wallet className="size-4" />
              {approving
                ? "Waiting for wallet…"
                : batchProgress
                  ? `Submit ${batchProgress.current} of ${batchProgress.total}`
                  : "Submit"}
            </Button>
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
    <dl className="border-aomi-border bg-aomi-raised grid gap-2 rounded-xl border p-3 text-[11px]">
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
              : compact(fee.asset.address)}
            {" → "}
            {compact(fee.recipient)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
