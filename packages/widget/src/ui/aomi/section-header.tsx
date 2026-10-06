"use client";

import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";

import { cn } from "@aomi-labs/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

/**
 * The heading above a `ListGroup` or card: title 13/600, then an optional
 * count, a short muted detail and a help tooltip for anything longer;
 * `action` sits at the far end.
 */
export function SectionHeader({
  title,
  as: Heading = "h3",
  id,
  count,
  help,
  detail,
  action,
  className,
}: {
  title: string;
  as?: "h2" | "h3";
  id?: string;
  /** Tabular tally shown after the title, e.g. the number of rows. */
  count?: ReactNode;
  /** Tooltip text behind a (?) button, labelled "About {title}". */
  help?: string;
  /** Short static context inline after the title (a few words or a count). */
  detail?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-7 items-center justify-between gap-3 px-0.5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Heading id={id} className="type-section truncate">
          {title}
        </Heading>
        {count !== undefined && count !== null ? (
          <span className="type-meta text-aomi-muted tabular-nums">
            {count}
          </span>
        ) : null}
        {detail ? (
          <span className="type-meta text-aomi-muted truncate">{detail}</span>
        ) : null}
        {help ? <HelpHint label={title} text={help} /> : null}
      </div>
      {action ? (
        <div className="flex shrink-0 items-center gap-1.5">{action}</div>
      ) : null}
    </div>
  );
}

/** A small (?) button that explains `label` in a tooltip. */
export function HelpHint({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`About ${label}`}
          className="border-aomi-border text-aomi-muted hover:text-aomi-fg flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors"
        >
          <CircleHelp size={12} />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={6}
        className="bg-aomi-fg text-aomi-bg z-[90] max-w-64 text-pretty"
      >
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
