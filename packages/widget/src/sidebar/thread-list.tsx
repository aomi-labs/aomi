"use client";

import {
  Fragment,
  type FC,
  type RefObject,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ThreadListItemPrimitive,
  ThreadListItemRuntimeProvider,
  useAssistantRuntime,
  ThreadListPrimitive,
  useThreadList,
  useThreadListItem,
} from "@assistant-ui/react";
import {
  ArchiveIcon,
  CheckIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";

import { cn, useOptionalAomiRuntime } from "@aomi-labs/react";
import { Button } from "@/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { testIds } from "@/test-ids";

export const ThreadList: FC = () => {
  return (
    <ThreadListPrimitive.Root
      data-testid={testIds.threadList}
      className="aui-root aui-thread-list-root flex w-full flex-1 list-none flex-col items-stretch gap-0.5 px-2"
    >
      <ThreadListNew />
      <ThreadListItems />
    </ThreadListPrimitive.Root>
  );
};

const ThreadListNew: FC = () => {
  return (
    <ThreadListPrimitive.New asChild>
      <Button
        data-testid={testIds.newChat}
        className="aui-thread-list-new border-aomi-border bg-aomi-raised hover:border-aomi-muted/60 hover:bg-aomi-raised flex items-center justify-start gap-2 rounded-[12px] border px-3 py-[9px] text-start text-sm font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors"
        variant="ghost"
      >
        <PlusIcon className="size-4" />
        New chat
      </Button>
    </ThreadListPrimitive.New>
  );
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Today", "Yesterday", "Previous 7 days", … from a thread's last activity. */
function recencyGroup(lastActiveAt: string | number | undefined, now: Date) {
  // The sessions API sends Unix seconds; locally created threads carry an ISO
  // string. Anything below 1e12 is seconds (1e12 ms is still 2001).
  const at =
    typeof lastActiveAt === "number"
      ? lastActiveAt < 1e12
        ? lastActiveAt * 1000
        : lastActiveAt
      : Date.parse(lastActiveAt ?? "");
  if (!Number.isFinite(at)) return "Recent";
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (at >= startOfToday) return "Today";
  if (at >= startOfToday - DAY_MS) return "Yesterday";
  if (at >= startOfToday - 7 * DAY_MS) return "Previous 7 days";
  if (at >= startOfToday - 30 * DAY_MS) return "Previous 30 days";
  return "Older";
}

const ThreadListItems: FC = () => {
  const threadIds = useThreadList((t) => t.threadIds);
  const runtime = useOptionalAomiRuntime();
  const metadata = runtime?.threadMetadata;

  // Rows arrive newest first; a label starts each run of the same recency.
  const groups = useMemo(() => {
    const now = new Date();
    return threadIds.map((id) =>
      recencyGroup(metadata?.get(id)?.lastActiveAt, now),
    );
  }, [threadIds, metadata]);

  // Bind subscribers to ids: archiving removes a regular-list index before
  // its old row can unmount, so an index-bound subscriber can look up undefined.
  return threadIds.map((id, index) => (
    <Fragment key={id}>
      {groups[index] !== groups[index - 1] ? (
        <span
          className={cn(
            "aui-thread-list-separator text-aomi-muted px-4 pb-2 text-left text-xs font-medium",
            index === 0 ? "pt-5" : "pt-4",
          )}
        >
          {groups[index]}
        </span>
      ) : null}
      <ThreadListRow id={id} />
    </Fragment>
  ));
};

const ThreadListRow: FC<{ id: string }> = ({ id }) => {
  const assistant = useAssistantRuntime();
  const runtime = useMemo(
    () => assistant.threads.getItemById(id),
    [assistant, id],
  );
  return (
    <ThreadListItemRuntimeProvider runtime={runtime}>
      <ThreadListItem />
    </ThreadListItemRuntimeProvider>
  );
};

const ThreadListItem: FC = () => {
  const thread = useThreadListItem();
  const runtime = useOptionalAomiRuntime();
  const saved = runtime?.isRemoteThread?.(thread.id) !== false;
  // Only the open chat's live state is known here: the dot blinks while Aomi
  // works and turns amber while a wallet request waits on the user.
  const current = runtime?.currentThreadId === thread.id;
  const status = !current
    ? null
    : runtime?.pendingActions?.length ||
        runtime?.commits?.some((commit) => commit.state === "needs_signature")
      ? "sign"
      : runtime?.isRunning
        ? "run"
        : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionsRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (wasEditing.current) {
      optionsRef.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing]);
  const startRename = () => {
    setTitle(thread.title ?? "New Chat");
    setError(null);
    setMenuOpen(false);
    setEditing(true);
  };
  const saveRename = async () => {
    const normalized = title.trim();
    if (saving || !runtime || !normalized) return;
    setSaving(true);
    setEditing(false);
    setError(null);
    try {
      await runtime.renameThread(thread.id, normalized);
      setEditing(false);
    } catch {
      setEditing(true);
      setError("Couldn't rename this chat. Try again.");
    } finally {
      setSaving(false);
    }
  };
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  // Grace delay so the pointer can travel the small gap from the button to the
  // portaled menu without the row's mouseleave closing it first.
  const scheduleClose = (event: PointerEvent<HTMLElement>) => {
    cancelClose();
    // Touch produces compatibility mouse events while a portaled menu opens.
    // Only a real hover-capable mouse should start the hover-close grace timer.
    if (
      event.pointerType !== "mouse" ||
      !event.currentTarget.ownerDocument.defaultView?.matchMedia(
        "(any-hover: hover)",
      ).matches
    )
      return;
    closeTimer.current = setTimeout(() => setMenuOpen(false), 120);
  };
  useEffect(() => cancelClose, []);

  return (
    <ThreadListItemPrimitive.Root
      data-thread-id={thread.id}
      data-testid={testIds.threadItem}
      className="aui-thread-list-item group/thread hover:bg-aomi-hover/60 focus-visible:bg-aomi-hover/60 data-active:bg-aomi-accent-subtle data-active:ring-aomi-accent/20 data-active:ring-1 data-active:ring-inset flex w-full min-w-0 flex-wrap items-center rounded-[12px] pr-2 transition-all focus-visible:outline-none"
      onPointerEnter={cancelClose}
      onPointerLeave={scheduleClose}
    >
      {editing ? (
        <form
          className="flex w-full min-w-0 items-center gap-1 py-1.5 pl-3"
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            void saveRename();
          }}
        >
          <input
            ref={inputRef}
            aria-label="Chat title"
            value={title}
            disabled={saving}
            maxLength={120}
            aria-invalid={Boolean(error)}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !saving) {
                event.preventDefault();
                setEditing(false);
              }
            }}
            className="border-aomi-border bg-aomi-bg text-aomi-fg focus-visible:ring-aomi-accent min-w-0 flex-1 rounded-md border px-2 py-1 text-sm outline-none focus-visible:ring-1"
          />
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={saving ? "Saving chat title" : "Save chat title"}
            aria-busy={saving}
            disabled={saving || !title.trim()}
          >
            <CheckIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label="Cancel rename"
            disabled={saving}
            onClick={() => setEditing(false)}
          >
            <XIcon className="size-3.5" />
          </Button>
        </form>
      ) : (
        <>
          <ThreadListItemPrimitive.Trigger className="aui-thread-list-item-trigger flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 pr-1 text-start">
            {/* Sky dot marks the active session; it blinks while Aomi works
                and turns amber while a wallet request waits on the user. */}
            <span
              aria-label={
                status === "sign"
                  ? "Waiting for your signature"
                  : status === "run"
                    ? "Working"
                    : undefined
              }
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                status === "sign"
                  ? "bg-aomi-warning opacity-100"
                  : "bg-aomi-accent-strong group-data-active/thread:opacity-100 opacity-0",
                status === "run" &&
                  "animate-pulse opacity-100 motion-reduce:animate-none",
              )}
            />
            <ThreadListItemTitle />
          </ThreadListItemPrimitive.Trigger>
          <ThreadListItemMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onContentPointerEnter={cancelClose}
            onContentPointerLeave={scheduleClose}
            onRename={runtime && saved ? startRename : undefined}
            saved={saved}
            triggerRef={optionsRef}
          />
        </>
      )}
      {editing && error && (
        <p role="alert" className="text-destructive w-full px-3 pb-2 text-xs">
          {error}
        </p>
      )}
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemTitle: FC = () => {
  return (
    <span
      data-testid={testIds.threadItemTitle}
      className="aui-thread-list-item-title text-aomi-muted group-hover/thread:text-aomi-fg group-data-active/thread:text-aomi-fg group-data-active/thread:font-medium block truncate text-sm transition-colors"
    >
      <ThreadListItemPrimitive.Title fallback="New Chat" />
    </span>
  );
};

const ThreadListItemMenu: FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContentPointerEnter: () => void;
  onContentPointerLeave: (event: PointerEvent<HTMLDivElement>) => void;
  onRename?: () => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  saved?: boolean;
}> = ({
  open,
  onOpenChange,
  onContentPointerEnter,
  onContentPointerLeave,
  onRename,
  triggerRef,
  saved = true,
}) => {
  // Collapsed to zero width by default so the title uses the full row; on row
  // hover / keyboard focus (scoped to *this* row via the named group) it
  // expands and the title reflows to a truncated "…". Named group so an
  // ancestor `.group` in a host app can't reveal every row at once. Pinned
  // open while the menu is showing, since the cursor leaves the row for the
  // portaled popover. Touch devices reveal the control without a hover gesture.
  const revealClass = open
    ? "w-7 opacity-100"
    : "w-0 opacity-0 group-hover/thread:w-7 group-hover/thread:opacity-100 group-focus-within/thread:w-7 group-focus-within/thread:opacity-100 [@media(hover:none)]:w-7 [@media(hover:none)]:opacity-100";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          className={cn(
            "aui-thread-list-item-menu-trigger text-aomi-muted hover:text-aomi-fg h-7 shrink-0 overflow-hidden rounded-md transition-all",
            revealClass,
          )}
          variant="ghost"
          size="icon"
          aria-label="Chat options"
          data-testid={testIds.threadItemMenu}
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
        onPointerEnter={onContentPointerEnter}
        onPointerLeave={onContentPointerLeave}
      >
        {onRename && (
          <button
            type="button"
            disabled={!saved}
            className="aui-thread-list-item-menu-item text-aomi-fg hover:bg-aomi-hover focus-visible:bg-aomi-hover flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm font-medium outline-none transition-colors"
            data-testid={testIds.rename}
            onClick={onRename}
          >
            <PencilIcon className="text-aomi-muted size-4" />
            Rename
          </button>
        )}
        <ThreadListItemPrimitive.Archive asChild>
          <button
            type="button"
            disabled={!saved}
            data-testid={testIds.archive}
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
