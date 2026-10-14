import type { ComponentProps, ReactNode } from "react";

import { cn } from "@aomi-labs/react";

/**
 * The card surface of a row group, without the row dividers — for panels
 * that place their own `Divider`s or hold non-row content.
 */
export const listGroupClass =
  "border-aomi-border bg-aomi-raised rounded-card overflow-hidden border";

/** A bordered card of `ListRow`s with a hairline between each row. */
export function ListGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(listGroupClass, "divide-aomi-border divide-y", className)}
      {...props}
    />
  );
}

export type ListRowProps = Omit<ComponentProps<"div">, "title"> & {
  /** Icon, avatar or brand mark before the text. */
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Render the description as an address/hash (mono 11.5). */
  descriptionMono?: boolean;
  /** Controls, values or a `StatusPill` at the end of the row. */
  trailing?: ReactNode;
};

/**
 * One 56px-minimum row: leading · title 14/500 over a 12px description ·
 * trailing. On narrow widths the trailing block wraps under the text.
 */
export function ListRow({
  leading,
  title,
  description,
  descriptionMono = false,
  trailing,
  className,
  ...props
}: ListRowProps) {
  return (
    <div
      className={cn(
        "flex min-h-14 flex-wrap items-center justify-between gap-3 px-3.5 py-3 sm:flex-nowrap",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {leading}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="type-row [overflow-wrap:anywhere] sm:truncate">
            {title}
          </div>
          {description ? (
            <div
              className={cn(
                "text-aomi-muted [overflow-wrap:anywhere] sm:truncate",
                descriptionMono ? "type-address" : "type-meta",
              )}
            >
              {description}
            </div>
          ) : null}
        </div>
      </div>
      {trailing ? (
        <div className="flex shrink-0 items-center gap-2">{trailing}</div>
      ) : null}
    </div>
  );
}
