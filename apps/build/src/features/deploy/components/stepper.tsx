import { CheckCircle2, Loader2, Circle, XCircle } from "lucide-react";

export type StepStatus = "done" | "active" | "pending" | "failed";

/** Horizontal dots: ●━━○━━○ with labels underneath. */
export function Stepper({
  steps,
  current,
  failed,
  activeBusy = false,
}: {
  steps: { key: string; label: string }[];
  current: string;
  failed?: boolean;
  activeBusy?: boolean;
}) {
  const currentIndex = steps.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center">
      {steps.map((step, i) => {
        const status: StepStatus =
          i < currentIndex
            ? "done"
            : i === currentIndex
              ? failed
                ? "failed"
                : i === steps.length - 1
                  ? "done"
                  : "active"
              : "pending";
        return (
          <li
            key={step.key}
            className="flex flex-1 items-center last:flex-none"
          >
            <div className="flex flex-col items-center gap-1">
              <Dot status={status} busy={activeBusy} />
              <span
                className={
                  status === "pending"
                    ? "text-muted-foreground/60 text-xs"
                    : "text-foreground text-xs font-medium"
                }
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`mx-2 mb-5 h-px flex-1 ${
                  i < currentIndex ? "bg-foreground/40" : "bg-border"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Dot({ status, busy = false }: { status: StepStatus; busy?: boolean }) {
  if (status === "done")
    return <CheckCircle2 className="h-5 w-5 text-green-500" />;
  if (status === "failed") return <XCircle className="h-5 w-5 text-red-500" />;
  if (status === "active") {
    return busy ? (
      <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
    ) : (
      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-blue-500">
        <span className="h-2 w-2 rounded-full bg-blue-500" />
      </span>
    );
  }
  return <Circle className="text-muted-foreground/40 h-5 w-5" />;
}
