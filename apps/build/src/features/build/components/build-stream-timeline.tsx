"use client";

import { Check, Circle, Loader2 } from "lucide-react";

import {
  STREAM_STAGE_LABELS,
  type BuildStreamEvent,
} from "@/features/build/contracts";
import { cn } from "@/lib/class-names";

type BuildStreamTimelineProps = {
  events: BuildStreamEvent[];
  compact?: boolean;
};

export function BuildStreamTimeline({
  events,
  compact,
}: BuildStreamTimelineProps) {
  return (
    <div
      className={cn(
        "border-border bg-surface-1 rounded-lg border",
        compact ? "p-3" : "p-4",
      )}
    >
      {!compact ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-subtle text-[12px] font-medium">Progress</p>
        </div>
      ) : null}
      <ol className={cn("space-y-3", compact && "space-y-2.5")}>
        {events.map((event) => (
          <li key={event.stage} className="flex gap-3">
            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
              {event.status === "done" ? (
                <Check className="text-positive size-3.5" />
              ) : event.status === "active" ? (
                <Loader2 className="text-warning size-3.5 animate-spin" />
              ) : (
                <Circle className="text-dim size-3" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-foreground text-[12px] font-medium">
                  {STREAM_STAGE_LABELS[event.stage]}
                </span>
                {event.status === "active" ? (
                  <span className="text-warning text-[10px]">Running</span>
                ) : null}
                {event.time ? (
                  <span className="text-dim text-[10px]">{event.time}</span>
                ) : null}
              </div>
              <p className="text-subtle mt-0.5 text-[12px]">{event.message}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
