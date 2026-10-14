export function StatusPill({ value }: { value: string }) {
  const tone =
    value === "ready" || value === "live" || value === "recorded"
      ? "border-positive/40 bg-positive/10 text-positive"
      : value === "failed"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-border bg-surface-2 text-foreground";
  return (
    <span
      className={`inline-flex h-6 items-center rounded-full border px-2 text-[10px] font-medium uppercase tracking-[0.05em] whitespace-nowrap ${tone}`}
    >
      {value}
    </span>
  );
}
