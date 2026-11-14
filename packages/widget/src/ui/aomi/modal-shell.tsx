"use client";

import { cn } from "@/lib/cn";
import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { X } from "lucide-react";

import { ModalBackdrop } from "@/ui/modal-backdrop";
import { LoadingLine } from "./loading-pane";

type IconComponent = ComponentType<{ className?: string }>;

/**
 * The full-frame directory modal shared by Library and Settings: backdrop,
 * shell (radius, border, shadow, fixed 1000×620 geometry), the round close
 * button, and a sidebar | content grid. `inspector` adds Library's fixed
 * 300px third column. Children are the grid cells — usually a
 * `ModalSidebar` followed by the content column.
 *
 * Below md the shell is a full-screen page: no radius, border or margin, and
 * it keeps clear of the host's safe areas (`--aomi-safe-top`,
 * `--aomi-safe-bottom`; a host that draws under the status bar sets them).
 */
export function ModalShell({
  labelledBy,
  dismissLabel,
  closeLabel,
  onClose,
  inspector = false,
  children,
}: {
  /** Id of the element naming the dialog (normally the `ModalSidebar` title). */
  labelledBy: string;
  /** Accessible name of the backdrop, e.g. "Dismiss settings". */
  dismissLabel: string;
  /** Accessible name of the close button, e.g. "Close settings". */
  closeLabel: string;
  onClose: () => void;
  inspector?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex: 60 }}
    >
      <ModalBackdrop aria-label={dismissLabel} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          "border-aomi-border bg-aomi-raised text-aomi-fg relative h-full w-full overflow-hidden",
          "max-md:animate-in max-md:fade-in-0 max-md:slide-in-from-bottom-3 motion-reduce:animate-none max-md:pb-[var(--aomi-safe-bottom,0px)] max-md:pt-[var(--aomi-safe-top,0px)] max-md:duration-200",
          "md:rounded-shell md:shadow-modal md:h-[620px] md:max-h-[92%] md:w-[1000px] md:max-w-[96%] md:border",
        )}
      >
        <ModalCloseButton
          label={closeLabel}
          onClick={onClose}
          className="absolute right-3 top-[calc(var(--aomi-safe-top,0px)+0.625rem)] z-20 max-md:size-10 md:right-4 md:top-4 max-md:[&>svg]:size-5"
        />
        <div
          className={cn(
            "grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] md:grid-rows-1",
            inspector
              ? "md:grid-cols-[185px_minmax(0,1fr)_300px]"
              : "md:grid-cols-[185px_minmax(0,1fr)]",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** The round close control. `ModalShell` already places one top-right. */
export function ModalCloseButton({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
        className,
      )}
    >
      <X className="size-3.5" />
    </button>
  );
}

/**
 * Left column: the modal's name (the dialog's label, so give it `titleId`)
 * above one or more `ModalNav`s. Stacks above the content on mobile.
 */
export function ModalSidebar({
  title,
  titleId,
  icon: Icon,
  className,
  children,
}: {
  title: string;
  titleId: string;
  icon: IconComponent;
  className?: string;
  children: ReactNode;
}) {
  return (
    <aside
      className={cn(
        "border-aomi-border bg-aomi-bg/40 min-h-0 min-w-0 border-b px-0 pb-2.5 pt-1.5 md:overflow-y-auto md:border-b-0 md:border-r md:p-3",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3 pr-14 md:px-2.5 md:pr-2.5">
        <Icon className="text-aomi-accent size-4 shrink-0" />
        <h1 id={titleId} className="type-title flex-1 max-md:text-[17px]">
          {title}
        </h1>
      </div>
      {children}
    </aside>
  );
}

/**
 * A labelled list of `ModalNavItem`s: a row on mobile that scrolls edge to
 * edge under a fade, a column from md.
 */
export function ModalNav({
  label,
  className,
  children,
}: {
  /** Accessible name, e.g. "Settings sections". */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "aomi-modal-nav flex gap-1.5 overflow-x-auto px-4 md:block md:space-y-0.5 md:px-0",
        className,
      )}
    >
      {children}
    </nav>
  );
}

export function ModalNavItem({
  label,
  icon: Icon,
  active,
  onClick,
  count,
}: {
  label: string;
  icon: IconComponent;
  active: boolean;
  onClick: () => void;
  /** Trailing tally, e.g. the number of entries in a Library section;
   * "loading" draws a placeholder until it is known. */
  count?: number | "loading";
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // On phones the nav is a sideways strip: bring a deep-linked tab into view.
  useEffect(() => {
    const item = ref.current;
    const nav = item?.closest("nav");
    if (!active || !item || !nav || nav.scrollWidth <= nav.clientWidth) return;
    const offset =
      item.getBoundingClientRect().left - nav.getBoundingClientRect().left;
    nav.scrollLeft += offset - (nav.clientWidth - item.offsetWidth) / 2;
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-control type-control flex h-[34px] w-auto shrink-0 items-center gap-2.5 px-2.5 transition-colors md:w-full",
        // Phone tabs are pills tall enough to hit with a thumb.
        "max-md:h-9 max-md:gap-2 max-md:rounded-full max-md:px-3.5 max-md:text-sm",
        // The nav scrolls, so an offset outline would be clipped: draw the
        // keyboard ring inside the item instead, and none after a click.
        "focus-visible:ring-aomi-ring/50 outline-none focus-visible:ring-2 focus-visible:ring-inset",
        active
          ? "bg-aomi-surface-2 text-aomi-fg font-medium"
          : "text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg max-md:bg-aomi-surface-2/40",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 whitespace-nowrap text-left">
        {label}
      </span>
      {count === "loading" ? (
        <LoadingLine className="w-4" />
      ) : count !== undefined ? (
        <span className="type-meta tabular-nums">{count}</span>
      ) : null}
    </button>
  );
}

/**
 * Content-column header: title 16/600 over a 12px subtitle. Keeps clear of
 * the shell's close button. No rule underneath — the content starts on the
 * same surface, as in Library.
 */
export function ModalHeader({
  title,
  description,
  titleId,
  trailing,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  titleId?: string;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-3 px-4 pb-2 pt-4 md:min-h-[74px] md:px-6 md:py-4 md:pr-14",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="type-title">
          {title}
        </h2>
        {description ? (
          <p className="type-meta text-aomi-muted mt-0.5">{description}</p>
        ) : null}
      </div>
      {trailing}
    </header>
  );
}
