export function DeploymentStatusDot({ state }: { state: string }) {
  const tone =
    state === "outdated"
      ? "bg-warning"
      : state === "ready" || state === "live" || state === "recorded"
        ? "bg-positive"
        : state === "failed" ||
            state === "deactivated" ||
            state === "incompatible"
          ? "bg-destructive"
          : "bg-muted-foreground";
  return <span className={`size-2 rounded-full ${tone}`} />;
}

export function DeploymentStatusPill({ value }: { value: string }) {
  const tone =
    value === "ready" || value === "live" || value === "recorded"
      ? "border-positive/40 bg-positive/10 text-positive"
      : value === "failed"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-border bg-surface-2 text-foreground";
  return (
    <span
      className={`inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2 text-[10px] font-medium uppercase tracking-[0.05em] ${tone}`}
    >
      {value}
    </span>
  );
}
