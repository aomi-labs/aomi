"use client";

import type { ReactNode } from "react";
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

/** A bordered step block, dimmed until it's the active step (or done). */
export function StepCard({
  index,
  title,
  state,
  children,
}: {
  index: number;
  title: string;
  state: StepStatus;
  children?: ReactNode;
}) {
  const dim = state === "pending";
  return (
    <div
      className={`border-input rounded-md border p-4 ${
        dim ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <StepBadge index={index} state={state} />
        <span className="text-foreground text-sm font-medium">{title}</span>
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

function StepBadge({ index, state }: { index: number; state: StepStatus }) {
  if (state === "done")
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />;
  if (state === "failed")
    return <XCircle className="h-4 w-4 shrink-0 text-red-500" />;
  if (state === "active")
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-blue-500">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
      </span>
    );
  return (
    <span className="border-border text-muted-foreground flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]">
      {index}
    </span>
  );
}
