"use client";

import { cn } from "@/lib/cn";
import {
  AnimatePresence,
  LazyMotion,
  domMax,
  m,
  useDragControls,
  useReducedMotion,
} from "motion/react";
import {
  lazy,
  Suspense,
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
import { ChevronDown, LoaderCircle, X } from "lucide-react";
import { useAomiRuntime } from "@aomi-labs/react";
import { projectCommitLifecycle, reviewEligibility } from "@aomi-labs/client";
import { useTraceAttribution } from "@/thread/trace-attribution";
import { packageChip } from "@/thread/attribution";
import { ToolChipView } from "@/thread/tool-chip";
import { traceIcon } from "@/thread/trace-icons";
import { SectionHeader } from "@/ui/aomi/section-header";
import {
  selectActivity,
  selectReviewCommit,
  type ActivityTransaction,
} from "./model";
import { focusRing } from "./presentation";
import { SubagentRow } from "./subagent-row";
import {
  HistoryRow,
  TransactionCard,
  isToSign,
  transactionProgress,
} from "./transactions";
import { WalletReview } from "./wallet-review";
import { PHONE_QUERY, useActivityPanel } from "./activity-panel-context";

const ScheduledApproval = lazy(() =>
  import("@/commit/approval").then((module) => ({
    default: module.ScheduledApproval,
  })),
);

export function ActivitySidebar() {
  return <ActivitySidebarContent />;
}

function ActivitySidebarContent() {
  const {
    events,
    pendingActions,
    actionAttempts,
    commits = [],
    retainedEvents,
    commitController,
    currentThreadId,
    getThreadMetadata,
  } = useAomiRuntime();
  // Refs a scheduled run of this chat parked on its own hidden thread.
  const scheduled = (
    getThreadMetadata(currentThreadId)?.awaitingApproval ?? []
  ).filter((ref) => !commits.some((commit) => commit.commit_id === ref));
  const reduceMotion = useReducedMotion();
  const {
    open: panelOpen,
    setOpen: setPanelOpen,
    setWorthShowing,
  } = useActivityPanel();
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
  // A sent transaction from a turn an Edit or Rerun removed keeps its
  // steps here (not in the chat), so History still names it.
  const activity = useMemo(
    () =>
      selectActivity(
        retainedEvents?.length ? [...retainedEvents, ...events] : events,
        pendingActions,
        commits,
      ),
    [retainedEvents, events, pendingActions, commits],
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
  const pendingCommit = selectReviewCommit(commits, commitController);
  const signing = Boolean(
    pendingCommit ||
    (pending &&
      (pending.request.type === "sign" ||
        reviewEligibility(pending.request)?.state === "eligible")),
  );
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
  for (const tx of transactionRows) {
    const key = batchKey(tx);
    if (!key) continue;
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
  const onChainPresentation = (tx: ActivityTransaction) => {
    const lifecycle = tx.commit
      ? projectCommitLifecycle(
          tx.commit,
          undefined,
          undefined,
          commitController?.onChainOutcome?.(tx.commit.commit_id),
        )
      : undefined;
    return lifecycle?.onChain ? lifecycle : undefined;
  };
  // An atomic group moves together: a member shares its leader's progress.
  const progress = (tx: ActivityTransaction): ActivityTransaction => {
    const commit = tx.commit && commitController?.groupView?.(tx.commit);
    return commit && commit !== tx.commit ? { ...tx, commit } : tx;
  };
  const card = (tx: ActivityTransaction, row = false) => (
    <TransactionCard
      key={tx.id}
      row={row}
      transaction={tx}
      onChain={onChainPresentation(tx)}
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
    activity.packages.length ||
    activity.transactions.length ||
    activity.history.length ||
    pendingActions.length ||
    commits.length ||
    scheduled.length,
  );
  const waiting = Boolean(pending || pendingCommit || scheduled.length);
  useEffect(() => {
    setWorthShowing(hasActivity, waiting);
  }, [hasActivity, waiting, setWorthShowing]);
  useEffect(() => () => setWorthShowing(false, false), [setWorthShowing]);
  // A new wallet request reopens the sheet: it holds the only sign controls.
  // Key it like WalletReview picks its request: the live commit comes first.
  const reviewKey = pendingCommit?.commit_id ?? pending?.id;
  useEffect(() => {
    if (sheet && reviewKey) setPanelOpen(true);
  }, [sheet, reviewKey, setPanelOpen]);
  const showRail = hasActivity && panelOpen;
  // Still in play (the current request, or a commit not yet settled) goes in
  // To sign; everything else is History, newest first.
  const isCurrent = (tx: ActivityTransaction) =>
    (tx.sequence ?? -Infinity) > turnStart;
  // A batch (one commit batch or one wallet request) moves as one: it stays
  // in To sign until every part of it is finished.
  const liveBatches = new Set(
    transactions
      .filter((tx) => isToSign(tx, isCurrent(tx)))
      .map((tx) => batchKey(tx) ?? tx.id),
  );
  const toSign = transactions.filter((tx) =>
    liveBatches.has(batchKey(tx) ?? tx.id),
  );
  const history = transactions.filter((tx) => !toSign.includes(tx));
  const hasToSign = Boolean(toSign.length || waiting);
  // A new wallet request reopens a folded To sign.
  const [signOpen, setSignOpen] = useState(true);
  useEffect(() => {
    if (reviewKey) setSignOpen(true);
  }, [reviewKey]);
  const transactionContent = (
    <>
      {toSign.length > 0 && (
        <div
          role="region"
          aria-label="Transactions to sign, in signing order"
          className="aui-current-transactions bg-aomi-surface rounded-control divide-aomi-border/70 divide-y overflow-hidden"
        >
          <AnimatePresence initial={false}>
            {toSign.map((tx) => card(progress(tx), true))}
          </AnimatePresence>
        </div>
      )}
      <WalletReview />
      {scheduled.length ? (
        <Suspense fallback={null}>
          <ScheduledApproval refs={scheduled} />
        </Suspense>
      ) : null}
    </>
  );
  const runningAgents = activity.agents.filter(
    (agent) => agent.status === "running",
  ).length;
  const failedHistory = history.filter((tx) => {
    const state = transactionProgress(tx);
    return (
      !state.rejected &&
      (state.failed || onChainPresentation(tx)?.onChain === "reverted")
    );
  }).length;
  const groups = (
    <>
      {activity.packages.length > 0 && (
        <Group
          title="Packages"
          count={activity.packages.length}
          summary={<PackageLogos ids={activity.packages} />}
        >
          <ActivePackages ids={activity.packages} />
        </Group>
      )}
      {activity.agents.length > 0 && (
        <Group
          title="Subagents"
          count={activity.agents.length}
          summary={
            runningAgents > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <LoaderCircle
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                {runningAgents} working
              </span>
            ) : undefined
          }
        >
          <ShowSome
            noun="subagents"
            limit={2}
            items={[...activity.agents]
              .map((agent, index) => ({ agent, index }))
              .sort(
                (a, b) =>
                  Number(b.agent.status === "running") -
                  Number(a.agent.status === "running"),
              )
              .map(({ agent, index }) => (
                <SubagentRow key={agent.agentId} agent={agent} index={index} />
              ))}
          />
        </Group>
      )}
      <SectionPresence show={hasToSign} id="to-sign">
        <Group
          title="To sign"
          count={toSign.length || undefined}
          open={signOpen}
          onOpenChange={setSignOpen}
          summary={
            waiting ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="bg-aomi-warning size-1.5 rounded-full"
                />
                waiting for you
              </span>
            ) : undefined
          }
        >
          {transactionContent}
        </Group>
      </SectionPresence>
      <SectionPresence show={history.length > 0} id="history">
        <Group
          title="History"
          count={history.length}
          summary={failedHistory ? `${failedHistory} failed` : undefined}
        >
          <ShowSome
            noun="transactions"
            limit={3}
            items={history.map((tx) => (
              <m.div
                key={tx.id}
                layout="position"
                initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.28,
                  ease: [0.22, 1, 0.36, 1],
                  // Arrive just after the card leaves To sign.
                  delay: reduceMotion ? 0 : 0.12,
                }}
                className="overflow-hidden"
              >
                <HistoryRow
                  transaction={tx}
                  onChain={onChainPresentation(tx)}
                />
              </m.div>
            ))}
          />
        </Group>
      </SectionPresence>
    </>
  );
  useLayoutEffect(() => {
    const parent = anchorRef.current?.parentElement;
    if (!parent) return;
    layoutParent.current = parent;
    if (compact || sheet) {
      parent.style.removeProperty("--activity-chat-max-width");
      return;
    }
    // Make room only as wide as the rail is now: 0 when it is about to slide
    // open (onUpdate then widens the room with it), full when it mounted
    // open. Jumping straight to full jerks the chat for a frame on open; a
    // closing rail keeps shrinking the room through onUpdate.
    const rail = railRef.current;
    if (!showRail && !rail) {
      parent.style.removeProperty("--activity-chat-max-width");
      return;
    }
    const progress = rail
      ? Math.max(0, Math.min(1, rail.getBoundingClientRect().width / 352))
      : 0;
    parent.style.setProperty(
      "--activity-chat-max-width",
      `calc(100% - (100cqw - 960px) * ${progress})`,
    );
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

/**
 * A panel section that folds to one line. Closed, `summary` stands in for
 * the content on the right of the title (logos, "2 working", a dot).
 */
function Group({
  title,
  count,
  summary,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  title: string;
  count?: number;
  summary?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = controlledOpen ?? ownOpen;
  const toggle = () => {
    if (onOpenChange) onOpenChange(!open);
    else setOwnOpen(!open);
  };

  return (
    <section className="py-3.5" aria-label={title}>
      <GroupHeader
        title={title}
        count={count}
        open={open}
        summary={open ? undefined : summary}
        onToggle={toggle}
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
        <div className="relative min-h-0 overflow-hidden">
          <div className="pt-2.5">{children}</div>
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
  summary,
  onToggle,
  className,
}: {
  title: string;
  count?: number;
  open: boolean;
  summary?: ReactNode;
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
      className={cn("group/header relative", className)}
      action={
        onToggle ? (
          <>
            {summary ? (
              <span className="type-meta text-aomi-muted group-hover/header:text-aomi-fg flex min-w-0 items-center transition-colors">
                {summary}
              </span>
            ) : null}
            <button
              type="button"
              aria-expanded={open}
              aria-labelledby={headingId}
              onClick={onToggle}
              className={cn(
                focusRing,
                "text-aomi-muted group-hover/header:text-aomi-fg rounded-control flex size-7 items-center justify-center transition-colors after:absolute after:inset-0 after:content-['']",
              )}
            >
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none",
                  open && "rotate-180",
                )}
              />
            </button>
          </>
        ) : undefined
      }
    />
  );
}

/** A section that slides open when it first has something and shut when it
 * empties, instead of popping in and out of the panel. */
function SectionPresence({
  show,
  id,
  children,
}: {
  show: boolean;
  id: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show && (
        <m.div
          key={id}
          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
          transition={{
            duration: reduceMotion ? 0 : 0.3,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="overflow-hidden"
        >
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
}

/** The first `limit` rows, then "Show all N" to open the rest. */
function ShowSome({
  items,
  limit,
  noun,
}: {
  items: ReactNode[];
  limit: number;
  noun: string;
}) {
  const [all, setAll] = useState(false);
  const more = items.length > limit;
  return (
    <div className="flex flex-col">
      <AnimatePresence initial={false}>
        {all || !more ? items : items.slice(0, limit)}
      </AnimatePresence>
      {more ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll(!all)}
          className={cn(
            focusRing,
            "type-meta text-aomi-muted hover:text-aomi-fg rounded-control mt-1 flex w-fit items-center gap-2 py-1 transition-colors motion-reduce:transition-none",
          )}
        >
          <span aria-hidden="true">⋯</span>
          {all ? `Show fewer ${noun}` : `Show all ${items.length} ${noun}`}
        </button>
      ) : null}
    </div>
  );
}

/** Folded Packages: each package's mark, as many as fit, then "+N". */
function PackageLogos({ ids }: { ids: string[] }) {
  const attribution = useTraceAttribution();
  const max = 7;
  return (
    <span className="flex items-center gap-1.5">
      {ids.slice(0, max).map((id) => {
        const chip = packageChip(id, attribution);
        const Glyph =
          attribution.packages?.find((item) => item.id === id)?.Icon ??
          traceIcon(chip.icon ?? "package");
        return (
          <Glyph
            key={id}
            className="size-3.5 shrink-0"
            aria-label={chip.label}
            role="img"
          />
        );
      })}
      {ids.length > max ? (
        <span className="tabular-nums">+{ids.length - max}</span>
      ) : null}
    </span>
  );
}

function ActivePackages({ ids }: { ids: string[] }) {
  const attribution = useTraceAttribution();
  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id) => (
        <ToolChipView key={id} chip={packageChip(id, attribution)} />
      ))}
    </div>
  );
}
