import { AllowanceRing } from "@/ui/aomi/allowance-ring";

/**
 * The account chip's compact summary: plan · allowance ring · dollars you can
 * spend. The ring is the monthly allowance left; the amount adds your funds.
 */
export function AccountStatusLine({
  creditsLine,
  planLabel,
  allowanceLeft,
}: {
  creditsLine: string;
  planLabel?: string;
  /** Fraction of the monthly allowance left, 0–1; omit without one. */
  allowanceLeft?: number;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 whitespace-nowrap tabular-nums">
      {planLabel ? (
        <>
          <span title={`${planLabel} plan`}>{planLabel}</span>
          <span className="opacity-50" aria-hidden="true">
            ·
          </span>
        </>
      ) : null}
      {allowanceLeft !== undefined ? (
        <AllowanceRing left={allowanceLeft} size={11} className="mx-px" />
      ) : null}
      <span title="Available to spend">{creditsLine}</span>
    </span>
  );
}
