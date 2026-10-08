"use client";

import { History } from "lucide-react";

import type { BuildSession } from "@/features/build/contracts";
import { JOURNEY_STAGES } from "@/features/build/contracts";
import { disambiguateSessionTitles } from "@/features/build/storage/session-title";
import { cn } from "@/lib/class-names";

type SessionHistoryProps = {
  sessions: BuildSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNewSession: () => void;
  className?: string;
};

function statusLabel(status: BuildSession["status"]) {
  if (status === "healthy") return "Ready";
  if (status === "failed") return "Failed";
  if (status === "running") return "In progress";
  return "Queued";
}

function statusTone(status: BuildSession["status"]) {
  if (status === "healthy") return "bg-positive/10 text-positive";
  if (status === "failed") return "bg-destructive/10 text-destructive";
  if (status === "running") return "bg-warning/10 text-warning";
  return "bg-surface-2 text-dim";
}

function stageLabel(stageId: BuildSession["stageId"]) {
  return JOURNEY_STAGES.find((s) => s.id === stageId)?.title ?? stageId;
}

/**
 * Thin in-page session list — product labels, not API enums.
 */
export function SessionHistory({
  sessions,
  activeSessionId,
  onSelect,
  onNewSession,
  className,
}: SessionHistoryProps) {
  const visible = disambiguateSessionTitles(sessions.slice(0, 12));

  return (
    <div className={cn("flex h-full flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="text-subtle flex items-center gap-1.5 text-[12px] font-medium">
          <History className="text-dim size-3.5" />
          Recent
        </div>
        <button
          type="button"
          onClick={onNewSession}
          className="text-dim hover:text-foreground text-[11px] transition-colors"
        >
          New
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <p className="text-dim px-1 py-3 text-[11px] leading-4">
            No builds yet. Describe an app to start.
          </p>
        ) : null}
        {visible.map((session) => (
          <button
            key={session.id}
            type="button"
            onClick={() => onSelect(session.id)}
            className={cn(
              "panel-row w-full text-left",
              activeSessionId === session.id &&
                "border-border-hover bg-accent",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-foreground truncate text-[13px]">
                {session.title}
              </p>
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  statusTone(session.status),
                )}
              >
                {statusLabel(session.status)}
              </span>
            </div>
            <p className="text-dim mt-0.5 text-[11px]">
              {stageLabel(session.stageId)} · {session.updatedAt}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
