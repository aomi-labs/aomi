"use client";

import {
  AnimatePresence,
  LazyMotion,
  domMax,
  m,
  useDragControls,
  useReducedMotion,
} from "motion/react";
import {
  useMemo,
  useEffect,
  useLayoutEffect,
  useId,
  useState,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronDown, X } from "lucide-react";
import { cn, useAomiRuntime } from "@aomi-labs/react";
import { projectCommitLifecycle, reviewEligibility } from "@aomi-labs/client";
import { useTraceAttribution } from "@/thread/trace-attribution";
import { skillChip } from "@/thread/tool-interpreter/attribution";
import { ToolChipView } from "@/thread/tool-chip";
import { SectionHeader } from "@/ui/aomi/section-header";
import {
  selectActivity,
  selectReviewCommit,
  type ActivityTransaction,
} from "./model";
import { focusRing } from "./presentation";
import { SubagentRow } from "./subagent-row";
import { TransactionCard, TransactionList } from "./transactions";
import { WalletReview } from "./wallet-review";
import { PHONE_QUERY, useActivityPanel } from "./activity-panel-context";

export function ActivitySidebar() {
  return <ActivitySidebarContent />;
}

function ActivitySidebarContent() {
  const {
    events,
    pendingActions,
    actionAttempts,
    commits = [],
    commitController,
  } = useAomiRuntime();
  const reduceMotion = useReducedMotion();
  const {
    open: panelOpen,
    setOpen: setPanelOpen,
    setWorthShowing,
  } = useActivityPanel();
  const [open, setOpen] = useState(true);
  const [compact, setCompact] = useState(false);
  const [sheet, setSheet] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const layoutParent = useRef<HTMLElement | null>(null);
  useEffect(
    () => () => {
      layoutParent.current?.style.removeProperty("--activity-chat-max-width");
    },
    [],
  );
  useLayoutEffect(() => {
    const parent = anchorRef.current?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const update = () => setCompact(parent.clientWidth < 900);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setSheet(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const activity = useMemo(
    () => selectActivity(events, pendingActions, commits),
    [events, pendingActions, commits],
  );
  // Work staged since the latest user message, callbacks included, is current.
  const turnStart = useMemo(
    () =>
      events.reduce(
        (latest, event) =>
          event.type === "message" && event.sender === "user"
            ? Math.max(latest, event.sequence)
            : latest,
        -Infinity,
      ),
    [events],
  );
  const pending = pendingActions[0];
  const pendingCommit = selectReviewCommit(commits, commitController?.review);
  const signing = Boolean(
    pendingCommit ||
    (pending &&
      (pending.request.type === "sign" ||
        reviewEligibility(pending.request)?.state === "eligible")),
  );
  const expanded = signing || open;
  const transactionRows = [
    ...new Map(
      [...activity.transactions, ...activity.history].map((tx) => [tx.id, tx]),
    ).values(),
  ];
  const batchKey = (tx: ActivityTransaction) =>
    tx.commit?.batch?.batch_id
      ? `commit:${tx.commit.batch.batch_id}`
      : tx.action?.id
        ? `action:${tx.action.id}`
        : undefined;
  const batchSequence = new Map<string, number>();
  const batchSizes = new Map<string, number>();
  for (const tx of transactionRows) {
    const key = batchKey(tx);
    if (!key) continue;
    batchSizes.set(key, (batchSizes.get(key) ?? 0) + 1);
    batchSequence.set(
      key,
      Math.max(
        batchSequence.get(key) ?? 0,
        tx.sequence ?? tx.action?.sequence ?? 0,
      ),
    );
  }
  const order = (tx: ActivityTransaction) =>
    batchSequence.get(batchKey(tx) ?? "") ?? tx.sequence ?? 0;
  const transactions = transactionRows.sort((a, b) => {
    const recency = order(b) - order(a);
    if (recency) return recency;
    const key = batchKey(a);
    if (key && key === batchKey(b)) {
      return (
        (a.commit?.batch?.index ?? a.actionIndex ?? 0) -
        (b.commit?.batch?.index ?? b.actionIndex ?? 0)
      );
    }
    return (b.sequence ?? 0) - (a.sequence ?? 0);
  });
  const card = (tx: ActivityTransaction) => (
    <TransactionCard
      key={tx.id}
      transaction={tx}
      batchSize={batchSizes.get(batchKey(tx) ?? "") ?? 1}
      reviewing={Boolean(
        pending
          ? tx.action?.id === pending.id
          : pendingCommit?.batch && tx.commit?.batch
            ? pendingCommit.batch.batch_id === tx.commit.batch.batch_id
            : pendingCommit?.commit_id === tx.commit?.commit_id,
      )}
      current={(tx.sequence ?? -Infinity) > turnStart}
      executing={
        Boolean(
          tx.action &&
          ["executing", "responding"].includes(
            actionAttempts.get(tx.action.id)?.state ?? "",
          ),
        ) ||
        Boolean(
          tx.commit &&
          ["preparing", "switching_chain", "awaiting_wallet"].includes(
            projectCommitLifecycle(
              tx.commit,
              commitController?.submissionPhase?.(tx.commit.commit_id),
              commitController?.recoveryRecord?.(tx.commit.commit_id),
            ).phase,
          ),
        )
      }
    />
  );
  const hasActivity = Boolean(
    activity.agents.length ||
    activity.skills.length ||
    activity.transactions.length ||
    activity.history.length ||
    pendingActions.length ||
    commits.length,
  );
  useEffect(() => {
    setWorthShowing(hasActivity, Boolean(pending || pendingCommit));
  }, [hasActivity, pending, pendingCommit, setWorthShowing]);
  useEffect(() => () => setWorthShowing(false, false), [setWorthShowing]);
  // A new wallet request reopens the sheet: it holds the only sign controls.
  // Key it like WalletReview picks its request: the live commit comes first.
  const reviewKey = pendingCommit?.commit_id ?? pending?.id;
  useEffect(() => {
    if (sheet && reviewKey) setPanelOpen(true);
  }, [sheet, reviewKey, setPanelOpen]);
  const showRail = hasActivity && panelOpen;
  const hasTransactions = Boolean(
    transactions.length > 0 || pending || pendingCommit,
  );
  const transactionContent = (
    <>
      <TransactionList
        newestId={transactions[0]?.id}
        count={transactions.length}
      >
        {transactions.map((tx) => card(tx))}
      </TransactionList>
      <WalletReview />
    </>
  );
  const groups = (
    <>
      {activity.agents.length > 0 && (
        <Group title="Subagents" count={activity.agents.length}>
          {activity.agents.map((agent, index) => (
            <SubagentRow key={agent.agentId} agent={agent} index={index} />
          ))}
        </Group>
      )}
      {activity.skills.length > 0 && (
        <Group title="Skills" count={activity.skills.length}>
          <InvokedSkills ids={activity.skills} />
        </Group>
      )}
      {hasTransactions && (
        <section className="py-4" aria-label="Transactions">
          <GroupHeader
            title="Transactions"
            count={transactions.length}
            open={expanded}
            // A pending signature keeps the list open.
            onToggle={signing ? undefined : () => setOpen(!open)}
            className="mb-3"
          />
          <AnimatePresence initial={false}>
            {expanded && (
              <m.div
                key="transaction-content"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.22,
                  ease: "easeOut",
                }}
                className="overflow-hidden"
              >
                {transactionContent}
              </m.div>
            )}
          </AnimatePresence>
        </section>
      )}
    </>
  );
  useLayoutEffect(() => {
    const parent = anchorRef.current?.parentElement;
    if (!parent) return;
    layoutParent.current = parent;
    if (showRail && !compact && !sheet)
      parent.style.setProperty(
        "--activity-chat-max-width",
        "calc(100% - (100cqw - 960px))",
      );
    else parent.style.removeProperty("--activity-chat-max-width");
  }, [showRail, compact, sheet]);
  if (sheet) {
    return (
      <>
        <span ref={anchorRef} className="hidden" aria-hidden="true" />
        <AnimatePresence initial={false}>
          {showRail && (
            <ActivitySheet
              key="activity"
              title={signing ? "Review transaction" : "Activity"}
              onClose={() => setPanelOpen(false)}
            >
              {signing ? (
                <div className="pb-4 pt-1">{transactionContent}</div>
              ) : (
                <div className="divide-aomi-border divide-y [&>section:first-child]:pt-2">
                  {groups}
                </div>
              )}
            </ActivitySheet>
          )}
        </AnimatePresence>
      </>
    );
  }
  return (
    <>
      <span ref={anchorRef} className="hidden" aria-hidden="true" />
      <AnimatePresence initial={false}>
        {showRail && (
          <m.aside
            ref={railRef}
            onUpdate={(latest) => {
              const parent = railRef.current?.parentElement;
              if (!parent || typeof latest.width !== "number") return;
              layoutParent.current = parent;
              const progress = Math.max(0, Math.min(1, latest.width / 352));
              parent.style.setProperty(
                "--activity-chat-max-width",
                `calc(100% - (100cqw - 960px) * ${progress})`,
              );
            }}
            key="activity"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 352, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{
              duration: reduceMotion ? 0 : 0.32,
              ease: [0.22, 1, 0.36, 1],
            }}
            aria-label="Chat activity"
            onKeyDown={(event) => {
              if (event.key === "Escape" && compact) {
                setPanelOpen(false);
              }
            }}
            className={cn(
              "aui-activity-sidebar max-h-full max-w-full shrink-0 overflow-y-auto overflow-x-hidden",
              compact ? "absolute right-0 top-0 z-30" : "relative top-0 block",
            )}
          >
            <div className="w-[352px] max-w-[100cqw] py-4 pl-3 pr-6">
              <div className="border-aomi-border bg-aomi-raised divide-aomi-border rounded-shell divide-y border px-4">
                {groups}
              </div>
            </div>
          </m.aside>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Phone presentation of the activity panel: a modal sheet over the chat and
 * composer. Drag the handle down, tap the scrim, or press Escape to close.
 * It is modal: focus stays inside until it closes.
 */
function ActivitySheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const dragControls = useDragControls();
  const titleId = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const occluded = useOccludedBottom(frameRef);
  useModalFocus(frameRef, sheetRef, onClose);
  const transition = {
    duration: reduceMotion ? 0 : 0.32,
    ease: [0.22, 1, 0.36, 1] as const,
  };
  // Own the drag and transform features: standalone consumers may not mount
  // LazyMotion, and without it the sheet would stay parked off-screen.
  return (
    <LazyMotion features={domMax}>
      <m.div
        ref={frameRef}
        className="absolute inset-0 z-30"
        data-testid="activity-sheet"
      >
        <m.div
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
          onClick={onClose}
          className="absolute inset-0 bg-black/40"
        />
        <m.aside
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={transition}
          drag="y"
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.6 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 96 || info.velocity.y > 500) onClose();
          }}
          ref={sheetRef}
          tabIndex={-1}
          onKeyDown={(event) => trapTab(event, sheetRef.current)}
          className="border-aomi-border bg-aomi-raised text-aomi-fg rounded-t-shell shadow-modal absolute inset-x-0 bottom-0 flex max-h-[calc(100%-1.5rem)] flex-col border-t outline-none"
        >
          <div
            onPointerDown={(event) => dragControls.start(event)}
            className="shrink-0 cursor-grab touch-none px-4 pb-2 pt-2 active:cursor-grabbing"
          >
            <div
              aria-hidden="true"
              className="bg-aomi-border mx-auto mb-2 h-1 w-9 rounded-full"
            />
            <div className="flex items-center justify-between gap-3">
              <h2 id={titleId} className="type-title">
                {title}
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                onPointerDown={(event) => event.stopPropagation()}
                className={cn(
                  focusRing,
                  "bg-aomi-surface-2 text-aomi-muted hover:text-aomi-fg flex size-8 items-center justify-center rounded-full transition-colors",
                )}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <div
            className="aui-activity-sidebar min-h-0 overflow-y-auto overscroll-contain px-4"
            style={{
              paddingBottom: `calc(${occluded}px + max(1rem, env(safe-area-inset-bottom)))`,
            }}
          >
            {children}
          </div>
        </m.aside>
      </m.div>
    </LazyMotion>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift+Tab cycling inside the open sheet. */
function trapTab(event: KeyboardEvent<HTMLElement>, sheet: HTMLElement | null) {
  if (event.key !== "Tab" || !sheet) return;
  const focusable = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === sheet)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Modal focus for the sheet: focus moves in on open and back to whatever
 * opened it on close, the chat behind it is inert, and Escape closes it from
 * anywhere on the page.
 */
function useModalFocus(
  frameRef: RefObject<HTMLElement | null>,
  sheetRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    sheetRef.current?.focus({ preventScroll: true });
    const frame = frameRef.current;
    const background = [...(frame?.parentElement?.children ?? [])].filter(
      (element): element is HTMLElement =>
        element !== frame && element instanceof HTMLElement && !element.inert,
    );
    for (const element of background) element.inert = true;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      for (const element of background) element.inert = false;
      // Not back into a text field: on a phone that reopens the keyboard.
      const editable =
        previous?.isContentEditable ||
        previous instanceof HTMLInputElement ||
        previous instanceof HTMLTextAreaElement;
      if (previous?.isConnected && !editable)
        previous.focus({ preventScroll: true });
    };
  }, [frameRef, sheetRef]);
}

/**
 * How far an element's bottom edge runs past the visible viewport. iOS Safari
 * sizes `100vh` layouts for its collapsed toolbar, so while the toolbar shows,
 * the bottom of the thread (and a sheet pinned to it) sits behind it.
 */
function useOccludedBottom(ref: RefObject<HTMLElement | null>) {
  const [occluded, setOccluded] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof window === "undefined") return;
    const viewport = window.visualViewport;
    const update = () => {
      const visibleBottom = viewport
        ? viewport.offsetTop + viewport.height
        : window.innerHeight;
      setOccluded(
        Math.max(
          0,
          Math.round(element.getBoundingClientRect().bottom - visibleBottom),
        ),
      );
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [ref]);
  return occluded;
}

function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="py-4" aria-label={title}>
      <GroupHeader
        title={title}
        count={count}
        open={open}
        onToggle={() => setOpen((current) => !current)}
      />
      <div
        aria-hidden={!open}
        inert={!open}
        data-activity-group-content={title}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pt-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

/**
 * A panel section's `SectionHeader`. With `onToggle`, the chevron is the
 * disclosure button and its hit area stretches over the whole header row.
 */
function GroupHeader({
  title,
  count,
  open,
  onToggle,
  className,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  const headingId = useId();
  return (
    <SectionHeader
      as="h2"
      id={headingId}
      title={title}
      count={count}
      className={cn("relative", className)}
      action={
        onToggle ? (
          <button
            type="button"
            aria-expanded={open}
            aria-labelledby={headingId}
            onClick={onToggle}
            className={cn(
              focusRing,
              "text-aomi-muted hover:text-aomi-fg rounded-control flex size-7 items-center justify-center transition-colors after:absolute after:inset-0 after:content-['']",
            )}
          >
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none",
                open && "rotate-180",
              )}
            />
          </button>
        ) : undefined
      }
    />
  );
}

function InvokedSkills({ ids }: { ids: string[] }) {
  const attribution = useTraceAttribution();
  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id) => (
        <ToolChipView key={id} chip={skillChip(id, attribution)} />
      ))}
    </div>
  );
}
