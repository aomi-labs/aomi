/** The same compact account summary in the sidebar chip and its menu. */
export function AccountStatusLine({
  creditsLine,
  planLabel,
}: {
  creditsLine: string;
  planLabel?: string;
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
      <span title="Credits remaining">
        {/^[\d,.\s]+$/.test(creditsLine)
          ? `${creditsLine} credits`
          : creditsLine}
      </span>
    </span>
  );
}
