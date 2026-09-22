"use client";

import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  useMemo,
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { cn, useAomiRuntime } from "@aomi-labs/react";
import { useTraceAttribution } from "../assistant-ui/trace-attribution";
import { skillChip } from "../assistant-ui/tool-interpreter/attribution";
import { ToolChipView } from "../assistant-ui/tool-chip";
import {
  selectActivity,
  selectReviewCommit,
  type ActivityTransaction,
} from "./model";
import { SubagentRow } from "./subagent-row";
import { TransactionCard, TransactionList } from "./transactions";
import { WalletReview } from "./wallet-review";
import { useActivityPanel } from "./activity-panel-context";

export function ActivitySidebar() {
  const { threadViewKey } = useAomiRuntime();
  return <ActivitySidebarContent key={threadViewKey} />;
}

function ActivitySidebarContent() {
  const {
    events,
    pendingActions,
    actionAttempts,
    threadViewKey,
    isRunning,
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
  const activity = useMemo(
    () => selectActivity(events, pendingActions, commits),
    [events, pendingActions, commits],
  );
  const pending = pendingActions[0];
  const pendingCommit = selectReviewCommit(commits, commitController?.review);
  const signing = Boolean(
    pendingCommit ||
    (pending &&
      (pending.request.type === "sign" ||
        (pending.request.simulation.status !== "failed" &&
          !pending.request.simulation.guards.some(
            (guard) => guard.status === "failed",
          )))),
  );
  const expanded = signing || open;
  const current = activity.transactions.filter(
    (tx) =>
      (!tx.action || tx.action.state === "pending") &&
      (!pending || tx.action?.id === pending.id),
  );
  const transactions = [
    ...new Map(
      [...activity.transactions, ...activity.history].map((tx) => [tx.id, tx]),
    ).values(),
  ].sort(
    (a, b) =>
      (b.sequence ?? b.action?.sequence ?? 0) -
        (a.sequence ?? a.action?.sequence ?? 0) ||
      (b.actionIndex ?? 0) - (a.actionIndex ?? 0),
  );
  const card = (tx: ActivityTransaction, historical = false) => (
    <TransactionCard
      key={tx.id}
      transaction={tx}
      reviewing={Boolean(
        pending
          ? tx.action?.id === pending.id
          : pendingCommit?.batch && tx.commit?.batch
            ? pendingCommit.batch.batch_id === tx.commit.batch.batch_id
            : pendingCommit?.commit_id === tx.commit?.commit_id,
      )}
      active={
        !historical &&
        ((tx.turnId === activity.turnId &&
          (isRunning ||
            pendingActions.some((action) => action.id === tx.action?.id))) ||
          (tx.commit != null &&
            !["confirmed", "rejected", "failed", "expired"].includes(
              tx.commit.state,
            )))
      }
      executing={
        !historical &&
        (Boolean(
          tx.action &&
          ["executing", "responding"].includes(
            actionAttempts.get(tx.action.id)?.state ?? "",
          ),
        ) ||
          Boolean(
            tx.commit?.wallet_attempt &&
            ["awaiting_wallet", "reported", "observing"].includes(
              tx.commit.wallet_attempt.state,
            ),
          ))
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
  const showRail = hasActivity && panelOpen;
  return (
    <>
      <span ref={anchorRef} className="hidden" aria-hidden="true" />
      <AnimatePresence>
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
            key={threadViewKey ?? "activity"}
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
              <div className="border-aomi-border bg-aomi-raised divide-aomi-border divide-y rounded-3xl border px-4">
                {activity.agents.length > 0 && (
                  <Group title="Subagents" count={activity.agents.length}>
                    {activity.agents.map((agent, index) => (
                      <SubagentRow
                        key={agent.agentId}
                        agent={agent}
                        index={index}
                      />
                    ))}
                  </Group>
                )}
                {activity.skills.length > 0 && (
                  <Group title="Skills" count={activity.skills.length}>
                    <InvokedSkills ids={activity.skills} />
                  </Group>
                )}
                {(transactions.length > 0 || pending || pendingCommit) && (
                  <section className="py-4" aria-label="Transactions">
                    {signing ? (
                      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-medium">
                        Transactions{" "}
                        <span className="text-aomi-muted font-normal">
                          {transactions.length}
                        </span>
                      </h2>
                    ) : (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setOpen(!open)}
                        className="mb-3 flex w-full items-center gap-2 text-[13px] font-medium"
                      >
                        Transactions{" "}
                        <span className="text-aomi-muted font-normal">
                          {transactions.length}
                        </span>
                        <ChevronDown
                          className={cn(
                            "text-aomi-muted ml-auto size-3.5 transition-transform motion-reduce:transition-none",
                            expanded && "rotate-180",
                          )}
                        />
                      </button>
                    )}
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
                          <TransactionList
                            newestId={transactions[0]?.id}
                            count={transactions.length}
                          >
                            {transactions.map((tx) =>
                              card(
                                tx,
                                Boolean(
                                  tx.action
                                    ? tx.action.state !== "pending"
                                    : tx.turnId !== activity.turnId,
                                ),
                              ),
                            )}
                          </TransactionList>
                          {pending && transactions.length > current.length && (
                            <p className="text-aomi-muted mt-3 text-[11px]">
                              Wallet request: {current.length} transaction
                              {current.length === 1 ? "" : "s"}.
                            </p>
                          )}
                          {(pending || pendingCommit) && (
                            <WalletReview
                              key={
                                pending
                                  ? `${pending.id}:${pending.revision}`
                                  : `${pendingCommit!.commit_id}:${pendingCommit!.version}`
                              }
                            />
                          )}
                        </m.div>
                      )}
                    </AnimatePresence>
                  </section>
                )}
              </div>
            </div>
          </m.aside>
        )}
      </AnimatePresence>
    </>
  );
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
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 text-left text-[13px] font-medium"
      >
        {title}
        <span className="text-aomi-muted font-normal tabular-nums">
          {count}
        </span>
        <ChevronDown
          className={cn(
            "text-aomi-muted ml-auto size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
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
