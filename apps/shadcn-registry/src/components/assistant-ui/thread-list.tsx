"use client";

import { type FC, useEffect, useRef, useState } from "react";
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useThreadList,
  useThreadListItem,
} from "@assistant-ui/react";
import { ArchiveIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";

import { cn } from "@aomi-labs/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export const ThreadList: FC = () => {
  return (
    <ThreadListPrimitive.Root className="aui-root aui-thread-list-root flex w-full flex-1 list-none flex-col items-stretch gap-0.5 px-2">
      <ThreadListNew />
      {/* Design mock: a "Recent" section label instead of a hairline */}
      <span className="aui-thread-list-separator text-aomi-muted px-4 pb-2 pt-5 text-left text-xs font-medium">
        Recent
      </span>
      <ThreadListItems />
    </ThreadListPrimitive.Root>
  );
};

const ThreadListNew: FC = () => {
  return (
    <ThreadListPrimitive.New asChild>
      <Button
        className="aui-thread-list-new border-aomi-border bg-aomi-raised hover:border-aomi-muted/40 hover:bg-aomi-surface-2 flex items-center justify-start gap-2 rounded-lg border px-3 py-[9px] text-start text-sm font-medium"
        variant="ghost"
      >
        <PlusIcon className="size-4" />
        New chat
      </Button>
    </ThreadListPrimitive.New>
  );
};

const ThreadListItems: FC = () => {
  const isLoading = useThreadList((t) => t.isLoading);

  if (isLoading) {
    return <ThreadListSkeleton />;
  }

  return <ThreadListPrimitive.Items components={{ ThreadListItem }} />;
};

const SKELETON_WIDTHS = [
  "85%",
  "72%",
  "90%",
  "68%",
  "78%",
  "95%",
  "74%",
  "82%",
  "70%",
  "88%",
  "76%",
  "92%",
  "80%",
  "69%",
  "86%",
  "73%",
  "91%",
  "77%",
  "84%",
  "71%",
];

const ThreadListSkeleton: FC = () => {
  return (
    <div
      role="status"
      aria-label="Loading threads"
      aria-live="polite"
      className="aui-thread-list-skeleton-root flex flex-1 flex-col gap-1 overflow-hidden"
    >
      {SKELETON_WIDTHS.map((width, i) => (
        <div
          key={i}
          className="aui-thread-list-skeleton-wrapper flex h-9 shrink-0 items-center rounded-2xl px-4"
        >
          <Skeleton
            className="aui-thread-list-skeleton h-3"
            style={{ width }}
          />
        </div>
      ))}
    </div>
  );
};

const ThreadListItem: FC = () => {
  const thread = useThreadListItem();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  // Grace delay so the pointer can travel the small gap from the button to the
  // portaled menu without the row's mouseleave closing it first.
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setMenuOpen(false), 120);
  };
  useEffect(() => cancelClose, []);

  return (
    <ThreadListItemPrimitive.Root
      data-thread-id={thread.id}
      className="aui-thread-list-item group/thread hover:bg-aomi-hover focus-visible:bg-aomi-hover data-active:bg-aomi-accent-subtle flex w-full min-w-0 items-center rounded-lg pr-2 transition-all focus-visible:outline-none"
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
    >
      <ThreadListItemPrimitive.Trigger className="aui-thread-list-item-trigger flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 pr-1 text-start">
        {/* Sky dot marks the active session, per the design mock */}
        <span className="bg-aomi-accent-strong group-data-active/thread:opacity-100 size-1.5 shrink-0 rounded-full opacity-0" />
        <ThreadListItemTitle />
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onContentMouseEnter={cancelClose}
        onContentMouseLeave={scheduleClose}
      />
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemTitle: FC = () => {
  return (
    <span className="aui-thread-list-item-title text-aomi-muted group-data-active/thread:text-aomi-fg block truncate text-sm">
      <ThreadListItemPrimitive.Title fallback="New Chat" />
    </span>
  );
};

const ThreadListItemMenu: FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContentMouseEnter: () => void;
  onContentMouseLeave: () => void;
}> = ({ open, onOpenChange, onContentMouseEnter, onContentMouseLeave }) => {
  // Collapsed to zero width by default so the title uses the full row; on row
  // hover / keyboard focus (scoped to *this* row via the named group) it
  // expands and the title reflows to a truncated "…". Named group so an
  // ancestor `.group` in a host app can't reveal every row at once. Pinned
  // open while the menu is showing, since the cursor leaves the row for the
  // portaled popover.
  const revealClass = open
    ? "w-7 opacity-100"
    : "w-0 opacity-0 group-hover/thread:w-7 group-hover/thread:opacity-100 group-focus-within/thread:w-7 group-focus-within/thread:opacity-100";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          className={cn(
            "aui-thread-list-item-menu-trigger text-aomi-muted hover:text-aomi-fg h-7 shrink-0 overflow-hidden rounded-md transition-all",
            revealClass,
          )}
          variant="ghost"
          size="icon"
          aria-label="Chat options"
          onClick={(event) => {
            // Only stop the row's click — do NOT preventDefault, or Radix's
            // PopoverTrigger will skip its own open/close toggle.
            event.stopPropagation();
          }}
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        alignOffset={0}
        className="aui-thread-list-item-menu-content border-aomi-overlay-border bg-aomi-raised w-44 rounded-xl border p-1.5"
        onClick={(event) => event.stopPropagation()}
        onMouseEnter={onContentMouseEnter}
        onMouseLeave={onContentMouseLeave}
      >
        <ThreadListItemPrimitive.Archive asChild>
          <button
            type="button"
            className="aui-thread-list-item-menu-item text-aomi-fg hover:bg-aomi-hover focus-visible:bg-aomi-hover flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm font-medium outline-none transition-colors"
            onClick={(event) => {
              event.stopPropagation();
              onOpenChange(false);
            }}
          >
            <ArchiveIcon className="text-aomi-muted size-4" />
            Archive
          </button>
        </ThreadListItemPrimitive.Archive>
      </PopoverContent>
    </Popover>
  );
};
