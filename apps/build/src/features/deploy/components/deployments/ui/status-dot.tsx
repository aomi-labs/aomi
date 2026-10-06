export function StatusDot({ state }: { state: string }) {
  const tone =
    state === "outdated"
      ? "bg-warning"
      : state === "ready" || state === "live" || state === "recorded"
        ? "bg-positive"
        : state === "failed" || state === "deactivated"
          ? "bg-destructive"
          : "bg-muted-foreground";
  return <span className={`size-2 rounded-full ${tone}`} />;
}
