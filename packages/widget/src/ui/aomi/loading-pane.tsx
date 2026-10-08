import { LoaderCircle } from "lucide-react";

import { cn } from "@aomi-labs/react";

/**
 * The one loading state for a pane or section: a quiet spinner centered on
 * both axes of whatever space its flex parent gives it. The label is for
 * screen readers only.
 */
export function LoadingPane({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(
        "flex min-h-32 w-full flex-1 items-center justify-center",
        className,
      )}
    >
      <LoaderCircle
        aria-hidden="true"
        className="text-aomi-muted size-5 animate-spin motion-reduce:animate-none"
        strokeWidth={1.75}
      />
    </div>
  );
}

/** A pulsing bar standing in for a short line of text until it loads. */
export function LoadingLine({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-aomi-surface-2 inline-block h-3 w-16 animate-pulse rounded-sm align-middle",
        className,
      )}
    />
  );
}
