import { cn } from "@/lib/cn";

/**
 * How much of the monthly allowance is left, as a ring that empties as it is
 * spent: sky normally, amber under 20%, a bare track when used up. Rings of
 * 40px and up print the percentage inside; smaller ones carry no number.
 */
export function AllowanceRing({
  left,
  size,
  className,
}: {
  /** Fraction of the allowance left, 0–1. */
  left: number;
  size: number;
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, left)) * 100);
  const small = size < 24;
  const stroke = small ? 6 : size < 48 ? 3.6 : 3.2;
  const label = `${pct}% of monthly allowance left`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden>
        <circle
          cx="18"
          cy="18"
          r="15.9155"
          fill="none"
          strokeWidth={stroke}
          className={small ? "stroke-aomi-border" : "stroke-aomi-surface-2"}
        />
        {pct > 0 ? (
          <circle
            cx="18"
            cy="18"
            r="15.9155"
            fill="none"
            strokeWidth={stroke}
            strokeLinecap={small ? "butt" : "round"}
            strokeDasharray={`${pct} ${100 - pct}`}
            transform="rotate(-90 18 18)"
            className={pct < 20 ? "stroke-aomi-warning" : "stroke-aomi-accent"}
          />
        ) : null}
      </svg>
      {size >= 40 ? (
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center justify-center font-semibold tabular-nums",
            size >= 56 ? "text-[12px]" : "text-[10px]",
            pct === 0 && "text-aomi-muted",
          )}
        >
          {pct}%
        </span>
      ) : null}
    </span>
  );
}
