"use client";

import type { ComponentType, ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@aomi-labs/react";
import { ModalBackdrop } from "../modal-backdrop";

type IconComponent = ComponentType<{ className?: string }>;

/**
 * The full-frame directory modal shared by Library and Settings: backdrop,
 * shell (radius, border, shadow, fixed 1000×620 geometry), the round close
 * button, and a sidebar | content grid. `inspector` adds Library's fixed
 * 300px third column. Children are the grid cells — usually a
 * `ModalSidebar` followed by the content column.
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
        className="border-aomi-border bg-aomi-raised text-aomi-fg rounded-shell shadow-modal relative overflow-hidden border"
        style={{ width: 1000, height: 620, maxWidth: "96%", maxHeight: "92%" }}
      >
        <ModalCloseButton
          label={closeLabel}
          onClick={onClose}
          className="absolute right-4 top-4 z-20"
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
        "border-aomi-border bg-aomi-bg/40 min-h-0 min-w-0 border-b p-3 md:overflow-y-auto md:border-b-0 md:border-r",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-2.5 py-3">
        <Icon className="text-aomi-accent size-4 shrink-0" />
        <h1 id={titleId} className="type-title flex-1">
          {title}
        </h1>
      </div>
      {children}
    </aside>
  );
}

/** A labelled list of `ModalNavItem`s: a scrolling row on mobile, a column from md. */
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
        "flex gap-1 overflow-x-auto md:block md:space-y-0.5",
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
  /** Trailing tally, e.g. the number of entries in a Library section. */
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-control type-control flex h-[34px] w-auto shrink-0 items-center gap-2.5 px-2.5 transition-colors md:w-full",
        // The nav scrolls, so an offset outline would be clipped: draw the
        // keyboard ring inside the item instead, and none after a click.
        "focus-visible:ring-aomi-ring/50 outline-none focus-visible:ring-2 focus-visible:ring-inset",
        active
          ? "bg-aomi-surface-2 text-aomi-fg font-medium"
          : "text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 whitespace-nowrap text-left">
        {label}
      </span>
      {count !== undefined ? (
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
        "flex min-h-[74px] shrink-0 items-center gap-3 px-4 py-3 pr-14 md:px-6 md:py-4 md:pr-14",
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
