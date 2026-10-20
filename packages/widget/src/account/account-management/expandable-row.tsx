import { Children, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@aomi-labs/react";
import { rowStart } from "./controls";

/**
 * A parent row (a login, an agent wallet, Telegram's bots): its mark, name
 * and grey line, then `trailing`. Clicking it shows or hides `children`, each
 * under a line; it is open while `defaultOpen` (e.g. it holds the Active
 * address) until you toggle it yourself. Without children nothing expands.
 */
export function ExpandableRow({
  label,
  defaultOpen,
  leading,
  title,
  description,
  trailing,
  children,
}: {
  /** What it shows or hides, e.g. "Privy addresses". */
  label: string;
  defaultOpen: boolean;
  leading: ReactNode;
  title: ReactNode;
  description: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const [toggled, setOpen] = useState<boolean | null>(null);
  const open = toggled ?? defaultOpen;
  const expands = Children.count(children) > 0;
  return (
    <>
      <div
        className={cn(
          "flex min-h-14 items-center gap-3 pr-3",
          rowStart(expands),
          expands && "hover:bg-aomi-hover transition-colors",
        )}
      >
        {expands ? (
          <ExpandToggle
            open={open}
            label={label}
            onToggle={() => setOpen(!open)}
          />
        ) : null}
        <button
          type="button"
          tabIndex={-1}
          disabled={!expands}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 text-left outline-none disabled:cursor-default"
        >
          {leading}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="type-row truncate">{title}</span>
            <span className="type-meta text-aomi-muted truncate">
              {description}
            </span>
          </span>
        </button>
        {trailing}
      </div>
      {open
        ? Children.map(children, (child) => (
            <div className="border-aomi-border border-t">{child}</div>
          ))
        : null}
    </>
  );
}

/**
 * The chevron in front of an expandable row's logo; it points down when
 * open. It sits in the row's edge ([`rowStart`]), so only rows that expand
 * carry it and the rest start at the usual edge.
 */
function ExpandToggle({
  open,
  label,
  onToggle,
}: {
  open: boolean;
  /** What it shows or hides, e.g. "Privy addresses". */
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className="text-aomi-muted hover:text-aomi-fg focus-visible:ring-aomi-accent-strong/40 -mr-3 flex size-3.5 shrink-0 items-center justify-center rounded-[5px] outline-none focus-visible:ring-2"
    >
      <ChevronRight
        className={cn(
          "size-3.5 transition-transform motion-reduce:transition-none",
          open && "rotate-90",
        )}
      />
    </button>
  );
}
