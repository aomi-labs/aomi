import { cn } from "@aomi-labs/widget";
import { Check, Circle, Loader2 } from "lucide-react";

import type { SmithersNode } from "@/features/build/contracts";

type PlanNodesProps = {
  nodes: SmithersNode[];
  /** Pass empty string to hide (parent section already titles the block). */
  caption?: string;
  compact?: boolean;
};

/** Build plan steps — product labels only (no engine/codenames). */
export function SmithersNodes({
  nodes,
  caption = "Build plan",
  compact = false,
}: PlanNodesProps) {
  if (!nodes.length) return null;

  return (
    <div
      className={cn(
        "border-border bg-aomi-raised rounded-card border",
        compact ? "p-3" : "mx-auto my-2 max-w-3xl p-4",
      )}
    >
      {caption ? (
        <p className="text-aomi-muted mb-3 text-[12px] font-medium">{caption}</p>
      ) : null}
      <ul className={cn("space-y-2", compact && "space-y-1.5")}>
        {nodes.map((node) => (
          <li
            key={node.id}
            className="border-border/80 bg-background flex gap-3 rounded-control border px-3 py-2.5"
          >
            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
              {node.status === "done" ? (
                <Check className="text-aomi-success size-3.5" />
              ) : node.status === "active" ? (
                <Loader2 className="text-aomi-warning size-3.5 animate-spin" />
              ) : (
                <Circle className="text-aomi-muted size-3" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-foreground text-[13px] font-medium">
                  {node.label}
                </span>
                <span className="text-aomi-muted text-[10px] uppercase tracking-wide">
                  {node.role}
                </span>
              </div>
              {!compact ? (
                <p className="text-aomi-muted mt-0.5 text-[12px] leading-4">
                  {node.detail}
                </p>
              ) : null}
            </div>
            <span
              className={cn(
                "shrink-0 self-start text-[10px] capitalize",
                node.status === "active"
                  ? "text-aomi-warning"
                  : node.status === "done"
                    ? "text-aomi-success"
                    : "text-aomi-muted",
              )}
            >
              {node.status === "done"
                ? "Done"
                : node.status === "active"
                  ? "Running"
                  : "Queued"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
